// 真实界面截图，套一个 Windows 风格的窗口框（这是 Windows 软件，不画 macOS 三个圆点）。
// 图片在 public/shots/：<name>.webp（1280 宽）与 <name>@2x.webp（2560 宽）；功能区的图只裁了有内容的上半部分。
const HEIGHTS = { overview: 800, apps: 470, nodes: 480 } as const;
type Props = { name: keyof typeof HEIGHTS; alt: string; eager?: boolean };

export function Screenshot({ name, alt, eager = false }: Props) {
  return (
    <figure className="ps-window">
      <div className="ps-window-bar" aria-hidden="true">
        <img src="/favicon.svg" alt="" width={14} height={14} />
        <span>ProxySplit</span>
        <i className="ps-window-ctl">
          <b />
          <b />
          <b />
        </i>
      </div>
      <img
        src={`/shots/${name}.webp`}
        srcSet={`/shots/${name}.webp 1280w, /shots/${name}@2x.webp 2560w`}
        sizes={eager ? "(max-width: 1180px) 100vw, 1120px" : "(max-width: 900px) 100vw, 700px"}
        width={1280}
        height={HEIGHTS[name]}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
      />
    </figure>
  );
}
