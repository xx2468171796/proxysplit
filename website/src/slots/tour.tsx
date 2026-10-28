// 功能插槽（锚点 #features）：「文字 + 真实截图」交替。配方的区块只能画示意图，真截图放这里。
import { Enter, Section } from "qiantai";
import { Shot, type ShotName } from "./shot";

type Row = { title: string; body: string; points: string[]; shot: ShotName; alt: string };

const ROWS: Row[] = [
  {
    title: "按程序分流",
    body: "从正在运行的程序里点选，或者从文件夹里挑 exe。每个程序单独选：智能分流、全部代理、不走代理，或者禁止联网。",
    points: [
      "只想让某个程序访问特定网站时才走代理？用「指定网站」限定域名、IP 或端口。",
      "「只代理列出的」和「默认全代理」两种模式，一键切换。",
      "改了就保存，代理运行中也立即生效，不用重启。",
    ],
    shot: "apps",
    alt: "应用分流页：每个程序一行，可选分流方式、节点、启用开关，并显示连接状态",
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
  {
    title: "换个顺眼的样子",
    body: "顶栏就能切节点、切「按规则 / 全部代理 / 全部直连」、开关整机接管（TUN）、看实时网速；浅色和深色各有一套配色。",
    points: [
      "右上角「外观」可以换背景特效、背景颜色、字体和字号、画质。",
      "窗口不在前台、一分钟没操作或用电池时，背景自动暂停省电。",
    ],
    shot: "look",
    alt: "外观面板：背景特效、背景配色、浓淡、毛玻璃面板和跟随鼠标",
  },
];

export function TourSlot() {
  return (
    <Section title="从添加程序到排查问题，都在一个窗口里" desc="不用改系统代理，也不用对着配置文件改来改去。">
      {ROWS.map((row, i) => (
        <Enter key={row.title} kind="fade" i={0}>
          <article className={`ps-feature${i % 2 ? " is-flipped" : ""}`}>
            <div className="ps-feature-copy">
              <h3>{row.title}</h3>
              <p className="q-muted">{row.body}</p>
              <ul>
                {row.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
            <Shot name={row.shot} alt={row.alt} />
          </article>
        </Enter>
      ))}
    </Section>
  );
}
