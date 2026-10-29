// 「连接」页：实时连接图（无限画布）。本机程序 → 直连 / 哪个节点 / 拦截 → 访问的网站；点程序展开 / 收起它访问的网站，
// 点任意节点在右侧看它的连接明细。数据每秒刷新（use-app-lifecycle 在这个页面开着时拉实时连接）。
import { Button, type Column, DataTable, PageBody, Panel, SegmentedControl, StatusBadge } from "@ankotti/admin-ui";
import { useEffect, useMemo, useState } from "react";
import type { Conn } from "../../api/types";
import { fmtBytes } from "../../shared/format";
import { useStore } from "../../shared/store";
import { isRunning, runtime } from "../../state/runtime";
import { FlowCanvas } from "./flow-canvas";
import { loadOffsets, type Offsets, saveOffsets } from "./flow-drag";
import { buildFlowGraph, type FlowNode, type RouteKind, routeKind, siteName } from "./flow-model";
import { FlowSvgContent, layout } from "./flow-svg";
import "./flows.css";

type Filter = "all" | RouteKind;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "proxy", label: "走代理" },
  { value: "direct", label: "直连" },
  { value: "block", label: "拦截" },
];

/** 选中节点涉及的连接 */
function connsOf(n: FlowNode | null, conns: Conn[]): Conn[] {
  if (!n) return [];
  const app = (c: Conn) => (c.process || "未知程序").replace(/\.exe$/i, "");
  if (n.lane === "app") return conns.filter((c) => app(c) === n.label || n.label === "其他程序");
  if (n.lane === "route")
    return conns.filter((c) => `r:${routeKind(c) === "proxy" ? c.outTag || "proxy" : routeKind(c)}` === n.id);
  return conns.filter((c) => siteName(c.host || c.dest) === n.label);
}

type Row = { key: string; c: Conn };
const COLUMNS: Column<Row>[] = [
  { key: "app", title: "程序", width: 140, render: ({ c }) => (c.process || "未知").replace(/\.exe$/i, "") },
  {
    key: "host",
    title: "网站",
    minWidth: 200,
    truncate: ({ c }) => c.host || c.dest,
    render: ({ c }) => c.host || c.dest,
  },
  {
    key: "route",
    title: "走向",
    width: 160,
    render: ({ c }) => (
      <StatusBadge tone={routeKind(c) === "proxy" ? "info" : routeKind(c) === "block" ? "danger" : "neutral"}>
        {c.outbound || c.outTag}
      </StatusBadge>
    ),
  },
  {
    key: "bytes",
    title: "流量",
    width: 100,
    numeric: true,
    render: ({ c }) => fmtBytes((c.upload || 0) + (c.download || 0)),
  },
];

function Detail({ node, conns }: { node: FlowNode | null; conns: Conn[] }) {
  if (!node) return <p className="ps-flow-hint">点图上的任意一个方块，这里列出它的连接明细。</p>;
  const rows = connsOf(node, conns)
    .slice(0, 200)
    .map((c, i) => ({ key: `${i}-${c.dest}`, c }));
  return (
    <DataTable<Row>
      caption="连接明细"
      rows={rows}
      rowKey={(r) => r.key}
      columns={COLUMNS}
      maxHeight={360}
      pagination={{ mode: "all" }}
      emptyLabel="这一项现在没有连接"
    />
  );
}

export function FlowsPage() {
  const all = useStore(runtime, (s) => s.conns);
  const running = useStore(runtime, (s) => isRunning(s.status));
  const [filter, setFilter] = useState<Filter>("all");
  // 记「收起了哪些程序」，默认全部展开
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<FlowNode | null>(null);
  const [offsets, setOffsets] = useState<Offsets>(loadOffsets);
  useEffect(() => saveOffsets(offsets), [offsets]);
  const conns = useMemo(() => (filter === "all" ? all : all.filter((c) => routeKind(c) === filter)), [all, filter]);
  const apps = useMemo(
    () => [
      ...new Set(
        buildFlowGraph(conns)
          .nodes.filter((n) => n.lane === "app")
          .map((n) => n.id),
      ),
    ],
    [conns],
  );
  const expanded = useMemo(() => new Set(apps.filter((id) => !collapsed.has(id))), [apps, collapsed]);
  const graph = useMemo(() => buildFlowGraph(conns, { expanded, maxSites: 60 }), [conns, expanded]);
  const { width, height } = layout(graph);
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const fitKey = `${filter}|${graph.nodes.length}|${collapsed.size}`;

  return (
    <PageBody>
      <div className="ps-flows">
        <Panel
          className="qd-pane"
          title="实时连接图"
          description={
            running
              ? `${graph.totalConns} 个连接 · 拖空白处平移、拖卡片挪位置，滚轮缩放，点程序展开它访问的网站`
              : "代理没在运行，没有连接"
          }
          actions={
            <span className="ps-row">
              <SegmentedControl size="sm" label="只看" options={FILTERS} value={filter} onValueChange={setFilter} />
              <Button size="sm" variant="outline" onClick={() => setCollapsed(new Set())}>
                全部展开
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(apps))}>
                全部收起
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={Object.keys(offsets).length === 0}
                disabledReason="还没拖过卡片"
                onClick={() => setOffsets({})}
              >
                重置布局
              </Button>
            </span>
          }
        >
          <FlowCanvas width={width} height={height} fitKey={fitKey}>
            <FlowSvgContent
              graph={graph}
              expanded={expanded}
              onToggle={toggle}
              selected={selected?.id}
              onSelect={setSelected}
              offsets={offsets}
              onMove={(id, o) => setOffsets((s) => ({ ...s, [id]: o }))}
            />
          </FlowCanvas>
        </Panel>
        <Panel className="qd-pane" title={selected ? `「${selected.label}」的连接` : "连接明细"}>
          <Detail node={selected} conns={conns} />
        </Panel>
      </div>
    </PageBody>
  );
}
