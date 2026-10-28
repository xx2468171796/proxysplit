// 下载插槽（锚点 #download）：最新版本号（接口实时读取）+ 下载按钮 + 联系方式（点一下复制）。
// admin-ui-audit-ignore-file raw-control: 官网是 qiantai 前台页，不加载 admin-ui 样式，控件用 qiantai 的 q-btn / q-input / q-chip 类
import { useState } from "react";
import { LATEST_DOWNLOAD, MAC_DOWNLOAD } from "../api";

const CONTACTS = [
  { label: "QQ 群", value: "719243244" },
  { label: "客服微信", value: "zyg69996" },
] as const;

function CopyChip({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(
      () => {
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      },
      () => undefined,
    );
  };
  return (
    <button type="button" className="q-chip ps-copy" onClick={copy} aria-label={`复制${label} ${value}`}>
      {label} <b>{value}</b>
      <span aria-live="polite">{done ? "已复制" : "复制"}</span>
    </button>
  );
}

export function DownloadSlot({ version }: { version: string | null }) {
  return (
    <section className="q-wrap">
      <div className="q-card ps-download">
        <div>
          <h2>现在就试试</h2>
          <p className="q-muted">
            Windows 10 / 11（64 位，单个 exe）· macOS 11 以上（Apple 芯片）{version ? ` · 当前版本 v${version}` : ""}
          </p>
          <div className="ps-contact">
            <span className="q-muted">有问题找我们</span>
            {CONTACTS.map((c) => (
              <CopyChip key={c.label} label={c.label} value={c.value} />
            ))}
          </div>
        </div>
        <div className="ps-download-btns">
          <a className="q-btn ps-download-btn" href={LATEST_DOWNLOAD}>
            Windows 版下载{version ? ` v${version}` : ""}
          </a>
          <a className="q-btn ghost ps-download-btn" href={MAC_DOWNLOAD}>
            macOS 版下载
          </a>
          <span className="q-muted ps-mac-tip">Mac 首次打开：右键 → 打开</span>
        </div>
      </div>
    </section>
  );
}
