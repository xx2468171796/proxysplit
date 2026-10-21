#!/usr/bin/env python3
"""深圳规则库镜像：每天把 sing-box 分流规则集从上游拉到 /opt/proxysplit/rules/。

客户端先从 https://proxysplit.zygskins.cn/rules/ 拉（国内直连），按 manifest.json 的
sha256 校验；镜像拉不到才回退到上游。由 proxysplit-rules.timer 每天跑一次。

每个文件：上游 GitHub → jsDelivr 依次尝试；必须 200、≤ 8MB、"SRS" 开头，且不能比
现有文件小一半以上（防上游临时出错把规则清空）。原子替换，旧文件留在 previous/。
任一文件失败时其余照常更新，manifest 只记录真正在盘上的文件，退出码非 0 让 systemd 记失败。
"""

import hashlib
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

ROOT = os.environ.get("PS_RULES_DIR", "/opt/proxysplit/rules")
MAX_BYTES = 8 << 20
MAGIC = b"SRS"
SHRINK_RATIO = 0.5

RULE_SETS = {
    "geoip-cn.srs": ("SagerNet/sing-geoip", "geoip-cn.srs"),
    "geosite-cn.srs": ("SagerNet/sing-geosite", "geosite-cn.srs"),
    "geosite-category-ads-all.srs": ("SagerNet/sing-geosite", "geosite-category-ads-all.srs"),
}


def sources(repo, path):
    return [
        f"https://raw.githubusercontent.com/{repo}/rule-set/{path}",
        f"https://cdn.jsdelivr.net/gh/{repo}@rule-set/{path}",
    ]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ProxySplit-rules-sync"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status != 200:
            raise ValueError(f"HTTP {resp.status}")
        body = resp.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("超过 8MB")
    if not body.startswith(MAGIC):
        raise ValueError(f"不是 SRS 文件（{len(body)} 字节）")
    return body


def write_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def load_manifest():
    try:
        with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
            return {item["name"]: item for item in json.load(f).get("files", [])}
    except (OSError, ValueError, KeyError):
        return {}


def sync_one(name, repo, path, old_meta):
    dst = os.path.join(ROOT, name)
    old = None
    if os.path.exists(dst):
        with open(dst, "rb") as f:
            old = f.read()
    errors = []
    for url in sources(repo, path):
        try:
            body = fetch(url)
        except Exception as e:  # noqa: BLE001 — 记录后换下一个源
            errors.append(f"{url}: {e}")
            continue
        if old is not None and len(body) < len(old) * SHRINK_RATIO:
            errors.append(f"{url}: 新文件 {len(body)} 字节，比现有 {len(old)} 小一半以上，拒收")
            continue
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if old == body:
            updated = (old_meta or {}).get("updatedAt", now)
            print(f"[rules] {name} 无变化（{len(body)} 字节）")
        else:
            if old is not None:
                write_atomic(os.path.join(ROOT, "previous", name), old)
            write_atomic(dst, body)
            updated = now
            print(f"[rules] {name} 已更新：{len(old or b'')} → {len(body)} 字节，来源 {url}")
        return {"name": name, "sha256": sha256(body), "size": len(body), "updatedAt": updated}, None
    return None, "; ".join(errors)


def main():
    os.makedirs(os.path.join(ROOT, "previous"), exist_ok=True)
    old_manifest = load_manifest()
    files, failed = [], []
    for name, (repo, path) in RULE_SETS.items():
        meta, err = sync_one(name, repo, path, old_manifest.get(name))
        if meta is None:
            failed.append(name)
            print(f"[rules] {name} 拉取失败：{err}", file=sys.stderr)
            # 保留盘上的旧文件，manifest 仍要对得上它
            dst = os.path.join(ROOT, name)
            if os.path.exists(dst):
                with open(dst, "rb") as f:
                    body = f.read()
                prev = old_manifest.get(name, {})
                files.append({"name": name, "sha256": sha256(body), "size": len(body),
                              "updatedAt": prev.get("updatedAt", "")})
            continue
        files.append(meta)
    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "files": files,
    }
    write_atomic(os.path.join(ROOT, "manifest.json"),
                 (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    if failed:
        print(f"[rules] {len(failed)} 个文件没更新：{', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    started = time.time()
    code = main()
    print(f"[rules] 完成，用时 {time.time() - started:.1f}s，退出码 {code}")
    sys.exit(code)
