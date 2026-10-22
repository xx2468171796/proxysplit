// 全部连接：每条连接一行（时间、哪个程序、访问目标、出口、结果、持续多久、流量），失败的在结果下面写原因，新的在最上面。
import { CellText, type Column, DataTable, StatusBadge, Tooltip } from "@ankotti/admin-ui";
import { useMemo } from "react";
import type { AppAccess } from "../../api/types";
import { fmtBytes } from "../../shared/format";
import { ruleText } from "../../shared/rule-text";
import { usePaged, withKeys } from "../ports/use-port-detail";
import { duration, plainReason } from "./monitor-view";

type Row = AppAccess & { key: string };

const TONE: Record<string, "neutral" | "warning" | "danger" | "success"> = {
  成功: "success",
  完成: "success",
  失败: "danger",
  拦截: "neutral",
  进行中: "neutral",
};

const STATUS_TIP: Record<string, string> = {
  成功: "收到了数据",
  完成: "很快就正常结束了，没报错",
  进行中: "连接还开着",
  拦截: "按规则被拦截",
};

const dash = (s?: string) => s || "—";
const clock = (t: string) => (t.length > 11 ? t.slice(11) : dash(t));

function Result({ a }: { a: Row }) {
  const r = plainReason(a.reason);
  const badge = (
    <StatusBadge variant="dot" tone={TONE[a.status] ?? "neutral"}>
      {a.status}
    </StatusBadge>
  );
  if (!r.short) return <Tooltip content={STATUS_TIP[a.status] ?? a.status}>{badge}</Tooltip>;
  return (
    <Tooltip content={r.detail}>
      <span className="ps-mon-result">
        {badge}
        <small className={a.status === "失败" ? "ps-mon-reason" : undefined}>{r.short}</small>
      </span>
    </Tooltip>
  );
}

const COLUMNS: Column<Row>[] = [
  { key: "time", title: "时间", width: 80, render: (a) => clock(a.time) },
  {
    key: "host",
    title: "访问目标",
    minWidth: 200,
    truncate: (a) => a.host,
    render: (a) => <CellText primary={dash(a.host)} secondary={`${a.network} · ${a.process}`} />,
  },
  { key: "out", title: "出口", width: 120, truncate: (a) => a.outbound, render: (a) => dash(a.outbound) },
  { key: "status", title: "结果", width: 150, mobile: "status", render: (a) => <Result a={a} /> },
  { key: "dur", title: "持续", width: 80, numeric: true, render: (a) => duration(a.seconds) },
  {
    key: "traffic",
    title: "↑ / ↓",
    width: 120,
    numeric: true,
    render: (a) => `${fmtBytes(a.upload)} / ${fmtBytes(a.download)}`,
  },
  { key: "rule", title: "命中规则", maxWidth: 200, truncate: (a) => a.rule, render: (a) => dash(ruleText(a.rule)) },
];

export function AppAccessTable({ access, resetKey = "" }: { access: AppAccess[]; resetKey?: string }) {
  const rows = useMemo(() => withKeys(access, (a) => `${a.time}|${a.host}|${a.network}|${a.process}`), [access]);
  const { slice, pagination } = usePaged(rows, 50, resetKey);
  return (
    <DataTable
      caption="全部连接"
      rowHeight="medium"
      rows={slice}
      columns={COLUMNS}
      rowKey={(a) => a.key}
      pagination={pagination}
      maxHeight={340}
      emptyLabel="没有符合条件的连接（每个程序最多保留最近 1000 条）"
    />
  );
}
