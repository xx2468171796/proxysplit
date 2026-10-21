// 端口详情里的三张表：来访设备（点一行只看该设备）、当前连接、访问日志；以及内核日志。
import { CellText, type Column, DataTable, StatePanel, StatusBadge } from "@ankotti/admin-ui";
import { type LogLine, LogStream } from "@ankotti/admin-ui/motion";
import { useMemo } from "react";
import type { Conn, PortAccess, PortClient } from "../../api/types";
import { fmtBytes, parseLog, stripAnsi } from "../../shared/format";
import { OutBadge } from "../logs/conns-section";
import { usePaged, withKeys } from "./use-port-detail";

const dash = (s?: string) => s || "—";
const shortTime = (t: string) => (t.length > 5 ? t.slice(5) : dash(t));

type ClientsProps = { clients: PortClient[]; selected: string; onSelect: (ip: string) => void };

const CLIENT_COLUMNS: Column<PortClient>[] = [
  { key: "ip", title: "设备 IP", minWidth: 130, render: (c) => <b>{c.ip}</b> },
  { key: "conns", title: "当前连接", width: 90, numeric: true, render: (c) => c.conns },
  { key: "total", title: "累计连接", width: 90, numeric: true, render: (c) => c.total },
  {
    key: "traffic",
    title: "流量 ↑ / ↓",
    width: 120,
    numeric: true,
    render: (c) => `${fmtBytes(c.upload)} / ${fmtBytes(c.download)}`,
  },
  { key: "last", title: "最近访问", width: 130, render: (c) => shortTime(c.lastSeen) },
];

/** 来访设备：点击一行只看这台设备的连接和日志，再点一次取消。 */
export function ClientsTable({ clients, selected, onSelect }: ClientsProps) {
  return (
    <DataTable
      caption="来访设备"
      rows={clients}
      columns={CLIENT_COLUMNS}
      rowKey={(c) => c.ip}
      selected={selected ? [selected] : []}
      onRowClick={(c) => onSelect(c.ip === selected ? "" : c.ip)}
      pagination={{ mode: "all" }}
      maxHeight={190}
      emptyLabel="还没有设备连过这个端口"
    />
  );
}

type ConnRow = Conn & { key: string };

const CONN_COLUMNS: Column<ConnRow>[] = [
  {
    key: "dest",
    title: "目标",
    minWidth: 200,
    truncate: (c) => c.host || c.dest,
    render: (c) => <CellText primary={c.host || c.dest || "—"} secondary={c.network} />,
  },
  { key: "source", title: "来源设备", width: 120, render: (c) => dash(c.source) },
  { key: "rule", title: "命中规则", maxWidth: 220, truncate: (c) => c.rule, render: (c) => dash(c.rule) },
  { key: "out", title: "出口", width: 150, render: (c) => <OutBadge c={c} />, mobile: "status" },
  { key: "up", title: "↑ 上传", width: 80, numeric: true, render: (c) => fmtBytes(c.upload) },
  { key: "down", title: "↓ 下载", width: 80, numeric: true, render: (c) => fmtBytes(c.download) },
];

export function ConnsTable({ conns }: { conns: Conn[] }) {
  const rows = useMemo(() => withKeys(conns, (c) => c.id || `${c.source}|${c.host}|${c.dest}|${c.network}`), [conns]);
  const { slice, pagination } = usePaged(rows);
  return (
    <DataTable
      caption="当前连接"
      rows={slice}
      columns={CONN_COLUMNS}
      rowKey={(c) => c.key}
      pagination={pagination}
      maxHeight={300}
      emptyLabel="暂无活动连接（有设备通过这个端口上网后自动出现）"
    />
  );
}

type AccessRow = PortAccess & { key: string };

const ACCESS_COLUMNS: Column<AccessRow>[] = [
  { key: "time", title: "时间", width: 150, render: (a) => dash(a.time) },
  { key: "client", title: "设备", width: 120, render: (a) => dash(a.client) },
  {
    key: "host",
    title: "访问目标",
    minWidth: 200,
    truncate: (a) => a.host,
    render: (a) => <CellText primary={dash(a.host)} secondary={a.network} />,
  },
  {
    key: "out",
    title: "出口",
    width: 130,
    render: (a) => (
      <StatusBadge
        variant="dot"
        tone={a.outbound === "拦截" ? "danger" : a.outbound === "直连" ? "neutral" : "success"}
      >
        {dash(a.outbound)}
      </StatusBadge>
    ),
  },
  { key: "rule", title: "命中规则", maxWidth: 220, truncate: (a) => a.rule, render: (a) => dash(a.rule) },
];

export function AccessTable({ access }: { access: PortAccess[] }) {
  const rows = useMemo(() => withKeys(access, (a) => `${a.time}|${a.client}|${a.host}|${a.network}`), [access]);
  const { slice, pagination } = usePaged(rows);
  return (
    <DataTable
      caption="访问日志"
      rows={slice}
      columns={ACCESS_COLUMNS}
      rowKey={(a) => a.key}
      pagination={pagination}
      maxHeight={300}
      emptyLabel="暂无访问记录（最新的在最上面，最多保留最近 1000 条）"
    />
  );
}

function levelOf(level: string): LogLine["level"] {
  if (level === "ERROR" || level === "FATAL" || level === "PANIC") return "error";
  return level === "WARN" ? "warn" : "info";
}

/** 内核日志：和「日志」页同样的列对齐和级别着色，新的在最下面。 */
export function CoreLogs({ logs }: { logs: string[] }) {
  const lines = useMemo<LogLine[]>(
    () =>
      logs.map((raw, id) => {
        const p = parseLog(stripAnsi(raw));
        const text = `${p.time || "--:--:--"}  ${p.level.padEnd(5)}  ${p.tag ? `[${p.tag}] ` : ""}${p.msg}`;
        return { id, text, level: levelOf(p.level) };
      }),
    [logs],
  );
  if (!lines.length) return <StatePanel kind="empty" title="暂无内核日志" size="compact" />;
  return <LogStream lines={lines} height={300} label="内核日志" />;
}
