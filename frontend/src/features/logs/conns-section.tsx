// 实时连接：进程 → 目标 → 命中规则 → 出口（日志页时应用生命周期每秒刷新一次）。
import { type Column, DataTable, QueryBar, ResourcePanel, StatusBadge } from "@ankotti/admin-ui";
import { useEffect, useMemo, useState } from "react";
import type { Conn } from "../../api/types";
import { fmtBytes } from "../../shared/format";
import { useStore } from "../../shared/store";
import { isRunning, refreshConns, runtime } from "../../state/runtime";
import { useFillHeight } from "./use-fill-height";

type Row = Conn & { key: string };

export function OutBadge({ c }: { c: Conn }) {
  if (c.outTag === "reject" || c.outTag === "block") {
    return (
      <StatusBadge tone="danger" variant="dot">
        {c.outbound || "拦截"}
      </StatusBadge>
    );
  }
  const direct = c.outTag === "direct";
  return (
    <StatusBadge tone={direct ? "neutral" : "success"} variant="dot">
      {c.outbound || (direct ? "直连" : "—")}
    </StatusBadge>
  );
}

const COLUMNS: Column<Row>[] = [
  { key: "process", title: "进程", width: 160, truncate: (c) => c.path || c.process, render: (c) => c.process || "—" },
  {
    key: "dest",
    title: "目标",
    minWidth: 200,
    truncate: (c) => (c.host && c.dest ? `${c.host}（${c.dest}）` : c.host || c.dest),
    render: (c) => (
      <span className="ps-conn-dest">
        {c.host || c.dest || "—"}
        {c.network ? <small>{c.network}</small> : null}
      </span>
    ),
  },
  { key: "rule", title: "命中规则", maxWidth: 260, truncate: (c) => c.rule, render: (c) => c.rule || "—" },
  { key: "out", title: "出口", width: 170, render: (c) => <OutBadge c={c} />, mobile: "status" },
  { key: "up", title: "↑ 上传", width: 84, numeric: true, render: (c) => fmtBytes(c.upload) },
  { key: "down", title: "↓ 下载", width: 84, numeric: true, render: (c) => fmtBytes(c.download) },
];

/** 同一进程 / 目标可能有多条连接：键里带上序号去重。 */
function withKeys(conns: Conn[]): Row[] {
  const seen = new Map<string, number>();
  return conns.map((c) => {
    const base = `${c.process}|${c.host}|${c.dest}|${c.network}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...c, key: `${base}#${n}` };
  });
}

export function ConnsSection() {
  const conns = useStore(runtime, (s) => s.conns);
  const running = useStore(runtime, (s) => isRunning(s.status));
  const [query, setQuery] = useState("");
  const height = useFillHeight(250);

  // 进入日志页立即拉一次，不等下一秒的定时器。
  useEffect(() => void refreshConns(), []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? conns.filter((c) => `${c.process} ${c.host} ${c.dest} ${c.rule} ${c.outbound}`.toLowerCase().includes(q))
      : conns;
    return withKeys(list);
  }, [conns, query]);

  let empty = "核心未运行 —— 到概览启动分流后这里显示实时连接";
  if (running) empty = query ? "无匹配连接" : "暂无活动连接（产生流量后自动出现）";

  return (
    <ResourcePanel
      title="实时连接"
      count={rows.length}
      unit="条"
      description="每条连接命中了哪条规则、走了哪个出口；每秒刷新。"
      filters={
        <QueryBar
          variant="flush"
          searchMode="live"
          placeholder="按进程 / 目标 / 规则 / 出口过滤"
          value={query}
          onChange={setQuery}
          onSearch={() => undefined}
          onReset={() => setQuery("")}
          canReset={!!query}
          hits={query ? rows.length : null}
        />
      }
    >
      <DataTable
        caption="实时连接"
        rows={rows}
        columns={COLUMNS}
        rowKey={(c) => c.key}
        pagination={{ mode: "all" }}
        maxHeight={height}
        emptyKind={query ? "no-results" : "empty"}
        emptyLabel={empty}
      />
    </ResourcePanel>
  );
}
