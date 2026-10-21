// 协议条 + 功能：两组「文字 + 截图」交替，再加三条小功能。文案只写软件真实能做的事。
import { LogoLoop } from "dongxiao/animations/logo-loop";
import "dongxiao/animations/logo-loop/styles.css";
import { CountUp } from "dongxiao/text/count-up";
import { useMotion } from "../site/motion-context";
import { useTokens } from "../site/theme-provider";
import { Screenshot } from "./screenshot";

const PROTOCOLS = ["HTTP", "HTTPS", "SOCKS5", "VLESS", "VMess", "Trojan", "Shadowsocks", "Hysteria2", "TUIC", "AnyTLS"];

export function ProtocolStrip() {
  const { paused } = useMotion();
  const tokens = useTokens();
  return (
    <section className="ps-protocols" aria-label="支持的节点协议">
      <div className="ps-wrap ps-protocols-row">
        <p>
          支持 <CountUp to={PROTOCOLS.length} duration={1.2} paused={paused} /> 种节点协议
        </p>
        <LogoLoop
          className="ps-protocols-loop"
          logos={PROTOCOLS.map((p) => ({ node: <span className="ps-protocol">{p}</span>, title: p }))}
          speed={36}
          gap={40}
          logoHeight={22}
          fadeOut
          fadeOutColor={tokens.bg}
          pauseOnHover
          paused={paused}
          ariaLabel="支持的节点协议"
        />
      </div>
    </section>
  );
}

type Row = { title: string; body: string; points: string[]; shot: "apps" | "nodes"; alt: string };

const ROWS: Row[] = [
  {
    title: "按程序分流",
    body: "从正在运行的程序里点选，或者从文件夹里挑 exe。每个程序单独选：按规则、全部代理、直连，或者直接拦截。",
    points: [
      "只想让某个程序访问特定网站时才走代理？用「目标条件」限定域名、IP 或端口。",
      "「只代理列出的」和「默认全代理」两种模式，一键切换。",
      "改了就保存，代理运行中也立即生效，不用重启。",
    ],
    shot: "apps",
    alt: "应用分流页：每个程序一行，可选分流方式、节点、启用开关和测试",
  },
  {
    title: "测速和排查",
    body: "每个节点都能测 TCP 延迟、Google 连通性和下载速度，挑出真正好用的那条。",
    points: [
      "订阅自动更新，节点再多也好管理。",
      "开了代理却上不了网时，会提示是不是被安全软件拦了，并告诉你去哪里放行。",
      "日志实时滚动，出错的行单独标出来。",
    ],
    shot: "nodes",
    alt: "节点页：每个节点的协议、TCP 延迟、Google 延迟和下载速度",
  },
];

const EXTRAS = [
  { title: "规则库", body: "国内网站、国内 IP 直连，广告域名直接拦截；规则库可以手动更新，也可以添加节点后自动更新。" },
  { title: "配置随身带", body: "应用规则能导出成一段文本，换了电脑粘贴导入就行；整份配置也能备份和恢复。" },
  { title: "放心升级", body: "新版本要同时通过签名和 SHA256 校验才会安装；装完自动重启，代理自动恢复。" },
];

export function Features() {
  return (
    <section className="ps-section" id="features">
      <div className="ps-wrap">
        <header className="ps-section-head">
          <h2>从添加程序到排查问题，都在一个窗口里</h2>
          <p>不用改系统代理，也不用对着配置文件改来改去。</p>
        </header>
        {ROWS.map((row, i) => (
          <article key={row.title} className={`ps-feature${i % 2 ? " is-flipped" : ""}`}>
            <div className="ps-feature-copy">
              <h3>{row.title}</h3>
              <p>{row.body}</p>
              <ul>
                {row.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            <Screenshot name={row.shot} alt={row.alt} />
          </article>
        ))}
        <div className="ps-extras">
          {EXTRAS.map((e) => (
            <div key={e.title}>
              <h3>{e.title}</h3>
              <p>{e.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
