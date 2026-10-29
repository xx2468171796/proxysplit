// 无限画布：拖空白处平移（拖卡片是挪卡片）、滚轮以鼠标为中心缩放、「适应窗口」一键看全图。内容是 FlowSvgContent。
import { IconButton } from "@ankotti/admin-ui";
import { Maximize, Minus, Plus } from "lucide-react";
import { type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ViewScale } from "./flow-drag";

type View = { x: number; y: number; k: number };
const MIN_K = 0.2;
const MAX_K = 3;

const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

type Props = { width: number; height: number; children: ReactNode /** 内容尺寸变了自动重新适应 */; fitKey?: string };

export function FlowCanvas({ width, height, children, fitKey }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 24, y: 24, k: 1 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const fitView = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const k = clampK(Math.min((el.clientWidth - 48) / width, (el.clientHeight - 48) / height, 1.2));
    setView({ k, x: (el.clientWidth - width * k) / 2, y: (el.clientHeight - height * k) / 2 });
  }, [width, height]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在图的结构变化（fitKey）时重新适应，平时保留用户的平移缩放
  useEffect(() => fitView(), [fitKey]);

  // 滚轮缩放要阻止页面滚动，React 的 onWheel 是 passive，只能原生绑定
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const k = clampK(v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoom = (f: number) => {
    const el = box.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setView((v) => {
      const k = clampK(v.k * f);
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest(".ps-flow-node")) return; // 点节点不拖动
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
  };
  const onUp = () => {
    drag.current = null;
  };

  return (
    <div
      ref={box}
      className="ps-flow-canvas"
      data-dragging={drag.current ? true : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <svg width="100%" height="100%" role="img" aria-label="连接图">
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <ViewScale.Provider value={view.k}>{children}</ViewScale.Provider>
        </g>
      </svg>
      <div className="ps-flow-tools">
        <IconButton size="sm" variant="outline" label="放大" icon={<Plus />} onClick={() => zoom(1.25)} />
        <IconButton size="sm" variant="outline" label="缩小" icon={<Minus />} onClick={() => zoom(0.8)} />
        <IconButton size="sm" variant="outline" label="适应窗口" icon={<Maximize />} onClick={fitView} />
        <span className="ps-flow-zoom ps-mono">{Math.round(view.k * 100)}%</span>
      </div>
    </div>
  );
}
