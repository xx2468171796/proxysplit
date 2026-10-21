// 使用步骤、使用须知（合规声明原文保留）、常见问题、页脚联系方式。
import { CopyButton } from "@ankotti/admin-ui";
import { LATEST_DOWNLOAD } from "../api";

const STEPS = [
  { title: "下载并打开", body: "单个 exe，双击就能用。第一次打开注册账号，领 3 天试用。" },
  { title: "导入你的节点", body: "粘贴分享链接或订阅地址；软件本身不提供节点。" },
  { title: "挑要分流的程序", body: "在「应用分流」里加入程序，给每个程序选好走法。" },
  { title: "点「启动」", body: "概览页能看到每个程序走的是哪条线路、延迟多少。" },
];

export function Steps() {
  return (
    <section className="ps-section">
      <div className="ps-wrap">
        <header className="ps-section-head">
          <h2>四步用起来</h2>
        </header>
        <ol className="ps-steps">
          {STEPS.map((s) => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Notice() {
  return (
    <section className="ps-section" id="notice">
      <div className="ps-wrap ps-notice">
        <h2>使用须知</h2>
        <p>ProxySplit 只提供本地的应用流量管理、网络技术学习和软件调试能力。</p>
        <p>我们不提供任何翻墙、VPN、代理节点、订阅或网络线路服务，也不对第三方网络资源的可用性或合法性作任何承诺。</p>
        <p>请严格遵守中华人民共和国法律法规，只在合法、获得授权的网络环境中使用，不得用于任何违法违规活动。</p>
      </div>
    </section>
  );
}

const FAQ = [
  {
    q: "ProxySplit 是 VPN 吗？",
    a: "不是。它不提供 VPN、代理节点、订阅或跨境网络服务，只负责在你的电脑上决定每个程序的流量怎么走。",
  },
  {
    q: "会上传我的节点和规则吗？",
    a: "不会。节点、订阅、应用规则和配置都保存在本机。会员服务只处理账号、设备摘要和授权状态。",
  },
  {
    q: "为什么每次打开都会检查更新？",
    a: "为了让每个人都用上修好问题的版本。发现新版本会自动下载、校验后安装，通常一分钟内完成，正在用的代理会自动恢复。",
  },
  { q: "支持哪些系统？", a: "64 位 Windows 10 和 Windows 11。软件是单个 exe，配置存在当前 Windows 用户目录下。" },
  {
    q: "一个账号能在几台电脑上用？",
    a: "普通会员 3 台，超级会员 8 台。换电脑时在软件的「账号与设备」里解绑旧的就行。",
  },
];

export function Faq() {
  return (
    <section className="ps-section" id="faq">
      <div className="ps-wrap ps-faq">
        <h2>常见问题</h2>
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function CopyChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="ps-copy aui-copy-host">
      {label} <b>{value}</b>
      <CopyButton text={value} label={label} size="sm" />
    </span>
  );
}

export function SiteFooter({ version }: { version: string | null }) {
  return (
    <footer className="ps-footer">
      <div className="ps-wrap ps-footer-row">
        <div>
          <a className="ps-brand" href="/">
            <img src="/favicon.svg" alt="" width={24} height={24} />
            <span>ProxySplit</span>
          </a>
          <p>Windows 上按程序分流的网络工具。</p>
          <a className="ps-footer-dl" href={LATEST_DOWNLOAD}>
            下载{version ? ` v${version}` : "最新版"}
          </a>
        </div>
        <div className="ps-contact">
          <p>有问题找我们</p>
          <CopyChip label="QQ 群" value="719243244" />
          <CopyChip label="客服微信" value="zyg69996" />
        </div>
      </div>
      <div className="ps-wrap ps-footer-legal">
        <span>© 2026 ProxySplit</span>
        <span>仅供学习与合法的软件调试使用，请遵守中华人民共和国法律法规</span>
      </div>
    </footer>
  );
}
