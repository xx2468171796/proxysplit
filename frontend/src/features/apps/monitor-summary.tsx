// 监测详情的概况区：一句话结论 → 关键数字 → 流量从哪些出口走 → 哪些程序在联网（整目录应用会有多个）。
import { InlineAlert, Tag, Tooltip } from "@ankotti/admin-ui";
import type { AppAccess, AppStat, ProcStat } from "../../api/types";
import { fmtBytes } from "../../shared/format";
import { exitSplit, verdict } from "./monitor-view";

const TONE = { idle: "info", ok: "success", warn: "warning", fail: "error" } as const;

const dash = (s?: string) => s || "—";
const clock = (t?: string) => (t && t.length > 11 ? t.slice(11) : dash(t));

function Numbers({ s }: { s?: AppStat }) {
  const items: [string, string, string?][] = [
    ["当前连接", String(s?.live ?? 0)],
    ["累计连接", String(s?.total ?? 0)],
    ["成功", String((s?.ok ?? 0) + (s?.done ?? 0)), "收到数据，或很快正常结束"],
    ["失败", String(s?.failed ?? 0), "内核报错，或连上了却一直没回应"],
    ["流量 ↑ / ↓", `${fmtBytes(s?.upload ?? 0)} / ${fmtBytes(s?.download ?? 0)}`],
    ["最近活动", clock(s?.lastSeen)],
  ];
  return (
    <dl className="ps-mon-grid">
      {items.map(([k, v, tip]) => (
        <div key={k} data-bad={(k === "失败" && v !== "0") || undefined}>
          <dt>
            {tip ? (
              <Tooltip content={tip}>
                <span>{k}</span>
              </Tooltip>
            ) : (
              k
            )}
          </dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Exits({ access }: { access: AppAccess[] }) {
  const split = exitSplit(access);
  if (!split.length) return null;
  return (
    <div className="ps-mon-line">
      <span className="ps-mon-label">出口</span>
      {split.slice(0, 6).map((x) => (
        <Tag key={x.exit} size="sm">
          {x.exit} · {x.count}
        </Tag>
      ))}
    </div>
  );
}

function Processes({ list }: { list: ProcStat[] }) {
  if (!list.length) return null;
  return (
    <div className="ps-mon-line">
      <span className="ps-mon-label">联网程序</span>
      {list.map((p) => (
        <Tooltip key={p.path || p.process} content={`${p.path || p.process} · ${p.total} 条连接，失败 ${p.failed}`}>
          <Tag size="sm">
            {p.process} · {p.total}
          </Tag>
        </Tooltip>
      ))}
    </div>
  );
}

type Props = { stat?: AppStat; access: AppAccess[]; processes: ProcStat[] };

export function MonitorSummary({ stat, access, processes }: Props) {
  const tone = TONE[stat?.health ?? "idle"] ?? "info";
  return (
    <section className="ps-mon-summary">
      <InlineAlert density="compact" tone={tone} title={verdict(stat)} />
      <Numbers s={stat} />
      <Exits access={access} />
      <Processes list={processes} />
    </section>
  );
}
