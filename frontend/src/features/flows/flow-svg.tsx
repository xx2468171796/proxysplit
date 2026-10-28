// 连接图的 SVG 渲染：三列节点（程序 / 路线 / 网站），之间用贝塞尔曲线相连，线宽按连接数，虚线流动表示有流量在走。
// 概览小图直接用；「连接」页把它放进可拖动缩放的画布（flow-canvas.tsx）。
import type { FlowGraph, FlowNode, Lane } from "./flow-model";

export const NODE_W = 196;
export const NODE_H = 40;
const GAP = 12;
const LANE_GAP = 170;

export type Placed = FlowNode & { x: number; y: number };

const LANES: Lane[] = ["app", "route", "site"];
export const LANE_TITLE: Record<Lane, string> = { app: "本机程序", route: "走哪条路", site: "访问的网站" };

/** 每列自上而下按连接数排，整列垂直居中。 */
export function layout(g: FlowGraph): { placed: Map<string, Placed>; width: number; height: number } {
  const cols = LANES.map((l) => g.nodes.filter((n) => n.lane === l));
  const tallest = Math.max(1, ...cols.map((c) => c.length));
  const height = tallest * (NODE_H + GAP) - GAP + 40;
  const placed = new Map<string, Placed>();
  cols.forEach((col, i) => {
    const colH = col.length * (NODE_H + GAP) - GAP;
    const top = 32 + (height - 32 - colH) / 2;
    col.forEach((n, j) => {
      placed.set(n.id, { ...n, x: i * (NODE_W + LANE_GAP), y: top + j * (NODE_H + GAP) });
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
};

export function FlowSvgContent({ graph, expanded, onToggle, selected, onSelect }: Props) {
  const { placed, width } = layout(graph);
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
      {[...placed.values()].map((n) => {
        const app = n.lane === "app";
        const open = app && (!expanded || expanded.has(n.id));
        return (
          // biome-ignore lint/a11y/useSemanticElements: SVG 里的可点节点，没有对应的 HTML 元素
          <g
            key={n.id}
            role="button"
            tabIndex={0}
            className="ps-flow-node"
            data-lane={n.lane}
            data-kind={n.kind}
            data-selected={selected === n.id || undefined}
            transform={`translate(${n.x},${n.y})`}
            onClick={() => {
              onSelect?.(n);
              if (app && onToggle) onToggle(n.id);
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                onSelect?.(n);
                if (app && onToggle) onToggle(n.id);
              }
            }}
          >
            <rect width={NODE_W} height={NODE_H} rx={10} />
            <text x={12} y={17} className="ps-flow-label">
              {short(n.label, 22)}
            </text>
            <text x={12} y={32} className="ps-flow-sub">
              {n.conns} 个连接
              {app && onToggle ? (open ? " · 点击收起" : " · 点击展开") : ""}
            </text>
            <title>{n.detail}</title>
          </g>
        );
      })}
      <rect x={0} y={0} width={width} height={1} fill="none" />
    </g>
  );
}
