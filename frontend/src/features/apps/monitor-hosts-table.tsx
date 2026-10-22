// 按网站汇总：每个访问目标一行（连接数、成功率、出口、流量、最近错误），有失败的排最前；点一行看它的每条连接。
import { CellText, type Column, DataTable, StatusBadge, Tooltip } from "@ankotti/admin-ui";
import { useMemo } from "react";
import type { HostStat } from "../../api/types";
import { fmtBytes } from "../../shared/format";
import { usePaged } from "../ports/use-port-detail";
import { plainReason, rate } from "./monitor-view";

const clock = (t: string) => (t.length > 11 ? t.slice(11) : t || "—");

function Health({ h }: { h: HostStat }) {
  if (h.failed && !(h.ok + h.done))
    return (
      <StatusBadge variant="dot" tone="danger">
        失败
      </StatusBadge>
    );
  if (h.failed)
    return (
      <StatusBadge variant="dot" tone="warning">
        部分失败
      </StatusBadge>
    );
  if (h.blocked && !(h.ok + h.done + h.live))
    return (
      <StatusBadge variant="dot" tone="neutral">
        拦截
      </StatusBadge>
    );
  if (h.live && !(h.ok + h.done))
    return (
      <StatusBadge variant="dot" tone="neutral">
        进行中
      </StatusBadge>
    );
  return (
    <StatusBadge variant="dot" tone="success">
      正常
    </StatusBadge>
  );
}

function Problem({ h }: { h: HostStat }) {
  if (!h.lastError) return null;
  const r = plainReason(h.lastError);
  return (
    <Tooltip content={r.detail}>
      <span className="ps-mon-reason">{r.short}</span>
    </Tooltip>
  );
}

const COLUMNS: Column<HostStat>[] = [
  {
    key: "host",
    title: "访问目标",
    minWidth: 220,
    truncate: (h) => h.host,
    render: (h) => <CellText primary={h.host || "—"} secondary={<Problem h={h} />} />,
  },
  { key: "health", title: "状态", width: 100, mobile: "status", render: (h) => <Health h={h} /> },
  {
    key: "conns",
    title: "连接 · 失败",
    width: 100,
    numeric: true,
    render: (h) => (
      <span>
        {h.conns} · <span data-bad={h.failed > 0 || undefined}>{h.failed}</span>
      </span>
    ),
  },
  { key: "rate", title: "成功率", width: 80, numeric: true, render: (h) => rate(h.ok + h.done, h.failed) },
  { key: "exit", title: "出口", width: 130, truncate: (h) => h.exit, render: (h) => h.exit || "—" },
  { key: "net", title: "协议", width: 72, render: (h) => h.network || "—" },
  {
    key: "traffic",
    title: "↑ / ↓",
    width: 120,
    numeric: true,
    render: (h) => `${fmtBytes(h.upload)} / ${fmtBytes(h.download)}`,
  },
  { key: "last", title: "最近", width: 80, render: (h) => clock(h.lastSeen) },
];

type Props = { hosts: HostStat[]; onOpen: (host: string) => void; resetKey: string };

export function MonitorHostsTable({ hosts, onOpen, resetKey }: Props) {
  const rows = useMemo(() => hosts, [hosts]);
  const { slice, pagination } = usePaged(rows, 50, resetKey);
  return (
    <DataTable
      caption="按网站汇总"
      rows={slice}
      columns={COLUMNS}
      rowKey={(h) => h.host}
      onRowClick={(h) => onOpen(h.host)}
      rowHeight="medium"
      pagination={pagination}
      maxHeight={340}
      emptyLabel="没有符合条件的网站"
    />
  );
}
