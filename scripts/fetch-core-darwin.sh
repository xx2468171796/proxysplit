#!/bin/sh
# 取 bin/darwin/core-release.json 固定的 macOS 内核到 bin/darwin/sing-box（sha256 不对就停）。
# 需要 GITEA_TOKEN（Gitea generic 包 gonggong/sing-box）；或 CORE_SRC=<本地文件> 直接用本机编好的。
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
meta="$root/bin/darwin/core-release.json"
want=$(sed -n 's/.*"sha256": *"\([0-9a-f]*\)".*/\1/p' "$meta")
url=$(sed -n 's/.*"url": *"\([^"]*\)".*/\1/p' "$meta")
dst="$root/bin/darwin/sing-box"
have() { [ -f "$1" ] && [ "$(shasum -a 256 "$1" | cut -d' ' -f1)" = "$want" ]; }
if have "$dst"; then echo "core ok"; exit 0; fi
tmp="$dst.tmp"
if [ -n "${CORE_SRC:-}" ]; then cp "$CORE_SRC" "$tmp"
else curl -fsSL --max-time 300 -H "Authorization: token ${GITEA_TOKEN:?GITEA_TOKEN or CORE_SRC}" "$url" -o "$tmp"; fi
have "$tmp" || { rm -f "$tmp"; echo "core sha256 mismatch" >&2; exit 1; }
chmod 755 "$tmp" && mv -f "$tmp" "$dst" && echo "core fetched"
