// 规则表「连接状态」格：健康度 + 当前连接数；点击打开该应用的监测详情。
import { Button, StatusBadge, Tooltip } from "@ankotti/admin-ui";
import type { AppHealth, AppRule, AppStat } from "../../api/types";
import { useStore } from "../../shared/store";
import { monitor, statKey } from "../../state/app-monitor";
import { monitorKey } from "../../state/app-rules";

export const HEALTH: Record<AppHealth, { label: string; tone: "neutral" | "warning" | "danger" | "success" }> = {
  idle: { label: "暂无流量", tone: "neutral" },
  ok: { label: "连接正常", tone: "success" },
  warn: { label: "部分失败", tone: "warning" },
  fail: { label: "连接失败", tone: "danger" },
};

export function HealthBadge({ stat }: { stat?: AppStat }) {
  const h = HEALTH[stat?.health ?? "idle"] ?? HEALTH.idle;
  return (
    <StatusBadge variant="dot" tone={h.tone}>
      {h.label}
    </StatusBadge>
  );
}

function tip(s?: AppStat): string {
  if (!s || !s.total) return "还没有捕捉到这个程序的连接。程序联网后自动出现；点开可「立即检测」。";
  return `当前 ${s.live} 个连接 · 累计 ${s.total} 个，成功 ${s.ok} / 完成 ${s.done} / 失败 ${s.failed}${s.lastHost ? ` · 最近访问 ${s.lastHost} → ${s.lastExit || "—"}` : ""}`;
}

export function MonitorCell({ rule, onOpen }: { rule: AppRule; onOpen: (process: string) => void }) {
  const name = monitorKey(rule);
  const stat = useStore(monitor, (s) => s.stats[statKey(name)]);
  return (
    <Tooltip content={tip(stat)}>
      <Button size="xs" variant="ghost" onClick={() => onOpen(name)}>
        <HealthBadge stat={stat} />
        {stat?.live ? <small className="ps-mon-live">{stat.live}</small> : null}
      </Button>
    </Tooltip>
  );
}
