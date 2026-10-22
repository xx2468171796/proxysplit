// 真实界面截图（无边框新界面，客户端 mock 预览里拍的）。截图自带客户端的标题栏和窗口按钮，外面只套圆角卡片，
// 不画系统窗口框（业主 2026-10-23：桌面端不显示系统标题栏 / Windows 窗口按钮）。
// 图片在 public/shots/：<name>.webp（1x）与 <name>@2x.webp；地址写全，评审包按字面量把它们换成 data URL。
const SHOTS = {
  overview: { src: "/shots/overview.webp", src2x: "/shots/overview@2x.webp", w: 1400, h: 900 },
  apps: { src: "/shots/apps.webp", src2x: "/shots/apps@2x.webp", w: 1400, h: 720 },
  nodes: { src: "/shots/nodes.webp", src2x: "/shots/nodes@2x.webp", w: 1400, h: 540 },
  look: { src: "/shots/look.webp", src2x: "/shots/look@2x.webp", w: 840, h: 600 },
} as const;

export type ShotName = keyof typeof SHOTS;
type Props = { name: ShotName; alt: string; eager?: boolean };

export function Shot({ name, alt, eager = false }: Props) {
  const s = SHOTS[name];
  return (
    <figure className="ps-shot">
      <img
        src={s.src}
        srcSet={`${s.src} ${s.w}w, ${s.src2x} ${s.w * 2}w`}
        sizes={eager ? "(max-width: 1200px) 100vw, 1136px" : "(max-width: 900px) 100vw, 640px"}
        width={s.w}
        height={s.h}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
      />
    </figure>
  );
}

/** 首屏下面的大图：概览页 */
export function PreviewSlot() {
  return (
    <div className="q-wrap ps-preview">
      <Shot
        name="overview"
        alt="ProxySplit 概览页：中间一个大的连接开关，旁边是运行时长、当前节点、上下行速度，下面是 AI 环境检测和常用操作"
        eager
      />
    </div>
  );
}
