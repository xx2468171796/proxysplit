// 连接图的 SVG 渲染：三列节点（程序 / 路线 / 网站），之间用贝塞尔曲线相连，线宽按连接数，虚线流动表示有流量在走。
// 概览小图直接用；「连接」页把它放进可拖动缩放的画布（flow-canvas.tsx）。
import { useContext, useRef } from "react";
import { type DragState, dragOffset, type Offset, type Offsets, ViewScale } from "./flow-drag";
import type { FlowGraph, FlowNode, Lane } from "./flow-model";

export const NODE_W = 196;
export const NODE_H = 40;
const GAP = 12;
const LANE_GAP = 170;

export type Placed = FlowNode & { x: number; y: number };
const ZERO: Offset = { dx: 0, dy: 0 };

const LANES: Lane[] = ["app", "route", "site"];
export const LANE_TITLE: Record<Lane, string> = { app: "本机程序", route: "走哪条路", site: "访问的网站" };

/** 每列自上而下按连接数排，整列垂直居中。 */
export function layout(
  g: FlowGraph,
  offsets?: Offsets,
): { placed: Map<string, Placed>; width: number; height: number } {
  const cols = LANES.map((l) => g.nodes.filter((n) => n.lane === l));
  const tallest = Math.max(1, ...cols.map((c) => c.length));
  const height = tallest * (NODE_H + GAP) - GAP + 40;
  const placed = new Map<string, Placed>();
  cols.forEach((col, i) => {
    const colH = col.length * (NODE_H + GAP) - GAP;
    const top = 32 + (height - 32 - colH) / 2;
    col.forEach((n, j) => {
      const o = offsets?.[n.id] ?? ZERO;
      placed.set(n.id, { ...n, x: i * (NODE_W + LANE_GAP) + o.dx, y: top + j * (NODE_H + GAP) + o.dy });
    });
  });
  return { placed, width: LANES.length * NODE_W + (LANES.length - 1) * LANE_GAP, height };
}

function edgeWidth(conns: number, max: number): number {
  return 1.5 + 6 * Math.sqrt(conns / Math.max(1, max));
}

function short(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

type Props = {
  graph: FlowGraph;
  expanded?: Set<string>;
  onToggle?: (appId: string) => void;
  selected?: string;
  onSelect?: (n: FlowNode) => void;
  /** 拖过的卡片偏移；传了 onMove 卡片就能拖 */
  offsets?: Offsets;
  onMove?: (id: string, o: Offset) => void;
};

export function FlowSvgContent({ graph, expanded, onToggle, selected, onSelect, offsets, onMove }: Props) {
  const { placed, width } = layout(graph, offsets);
  const maxConns = Math.max(1, ...graph.edges.map((e) => e.conns));
  return (
    <g className="ps-flow">
      {LANES.map((l, i) => (
        <text key={l} className="ps-flow-lane" x={i * (NODE_W + LANE_GAP) + NODE_W / 2} y={14} textAnchor="middle">
          {LANE_TITLE[l]}
        </text>
      ))}
      {graph.edges.map((e) => {
        const a = placed.get(e.from);
        const b = placed.get(e.to);
        if (!a || !b) return null;
        const x1 = a.x + NODE_W;
        const y1 = a.y + NODE_H / 2;
        const x2 = b.x;
        const y2 = b.y + NODE_H / 2;
        const mid = (x1 + x2) / 2;
        const w = edgeWidth(e.conns, maxConns);
        const d = `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
        const hot = selected && (e.from === selected || e.to === selected);
        return (
          <g key={e.id} className="ps-flow-edge" data-kind={e.kind} data-hot={hot || undefined}>
            <path d={d} strokeWidth={w} className="ps-flow-edge-base" />
            <path d={d} strokeWidth={Math.max(1.5, w * 0.45)} className="ps-flow-edge-dash" />
            <title>{`${e.conns} 个连接`}</title>
          </g>
        );
      })}
      {[...placed.values()].map((n) => (
        <FlowNodeView
          key={n.id}
          n={n}
          open={n.lane === "app" && (!expanded || expanded.has(n.id))}
          toggleable={Boolean(onToggle)}
          selected={selected === n.id}
          offset={offsets?.[n.id] ?? ZERO}
          onMove={onMove}
          onActivate={() => {
            onSelect?.(n);
            if (n.lane === "app" && onToggle) onToggle(n.id);
          }}
        />
      ))}
      <rect x={0} y={0} width={width} height={1} fill="none" />
    </g>
  );
}
type NodeProps = {
  n: Placed;
  open: boolean;
  toggleable: boolean;
  selected: boolean;
  offset: Offset;
  onActivate: () => void;
  onMove?: (id: string, o: Offset) => void;
};

/** 一张卡片：点 = 选中 / 展开；有 onMove 时按住拖动可以挪位置（拖过就不算点击）。 */
function FlowNodeView({ n, open, toggleable, selected, offset, onActivate, onMove }: NodeProps) {
  const k = useContext(ViewScale);
  const drag = useRef<DragState | null>(null);
  const app = n.lane === "app";
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG 里的可点节点，没有对应的 HTML 元素
    <g
      role="button"
      tabIndex={0}
      className="ps-flow-node"
      data-lane={n.lane}
      data-kind={n.kind}
      data-selected={selected || undefined}
      data-draggable={onMove ? true : undefined}
      transform={`translate(${n.x},${n.y})`}
      onPointerDown={(e) => {
        if (!onMove || e.button !== 0) return;
        drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, ox: offset.dx, oy: offset.dy, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const o = d && onMove ? dragOffset(d, e.clientX, e.clientY, k) : null;
        if (o) onMove?.(n.id, o);
      }}
      onClick={() => {
        const moved = drag.current?.moved;
        drag.current = null;
        if (!moved) onActivate();
      }}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") onActivate();
      }}
    >
      <rect width={NODE_W} height={NODE_H} rx={10} />
      <text x={12} y={17} className="ps-flow-label">
        {short(n.label, 22)}
      </text>
      <text x={12} y={32} className="ps-flow-sub">
        {n.conns} 个连接
        {app && toggleable ? (open ? " · 点击收起" : " · 点击展开") : ""}
      </text>
      <title>{n.detail}</title>
    </g>
  );
}
