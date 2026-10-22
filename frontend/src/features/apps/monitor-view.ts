// 监测详情的纯逻辑：状态筛选、搜索、一句话结论、失败原因转人话。界面只管摆放。
import type { AppAccess, AppStat, HostStat } from "../../api/types";

export type StatusFilter = "all" | "live" | "ok" | "failed" | "blocked";

/** 访问日志里的状态 → 属于哪个筛选（「完成」算正常，和成功放一起） */
const STATUS_OF: Record<string, StatusFilter> = {
  进行中: "live",
  成功: "ok",
  完成: "ok",
  失败: "failed",
  拦截: "blocked",
};

export function statusOf(a: AppAccess): StatusFilter {
  return STATUS_OF[a.status] ?? "ok";
}

const has = (text: string | undefined, q: string) => !!text && text.toLowerCase().includes(q);

export function matchAccess(a: AppAccess, filter: StatusFilter, query: string, host: string): boolean {
  if (filter !== "all" && statusOf(a) !== filter) return false;
  if (host && a.host !== host) return false;
  const q = query.trim().toLowerCase();
  return !q || has(a.host, q) || has(a.process, q) || has(a.outbound, q) || has(a.reason, q) || has(a.rule, q);
}

export function matchHost(h: HostStat, filter: StatusFilter, query: string): boolean {
  if (filter === "live" && !h.live) return false;
  if (filter === "ok" && !(h.ok + h.done)) return false;
  if (filter === "failed" && !h.failed) return false;
  if (filter === "blocked" && !h.blocked) return false;
  const q = query.trim().toLowerCase();
  return !q || has(h.host, q) || has(h.exit, q) || has(h.lastError, q);
}

export type Counts = Record<StatusFilter, number>;

export function countAccess(list: AppAccess[]): Counts {
  const c: Counts = { all: list.length, live: 0, ok: 0, failed: 0, blocked: 0 };
  for (const a of list) c[statusOf(a)] += 1;
  return c;
}

/** 出口分布：节点名 / 直连 / 拦截 → 连接数，多的在前 */
export function exitSplit(list: AppAccess[]): { exit: string; count: number }[] {
  const m = new Map<string, number>();
  for (const a of list) {
    const k = a.outbound || "未出站";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([exit, count]) => ({ exit, count })).sort((x, y) => y.count - x.count);
}

/** 头部的一句话结论 */
export function verdict(s: AppStat | undefined): string {
  if (!s || !s.total) return "还没有捕捉到这个应用的连接：打开应用联网后这里自动出现，或点「立即检测」。";
  const judged = s.ok + s.done + s.failed;
  const rate = judged ? Math.round(((s.ok + s.done) / judged) * 100) : 100;
  if (s.health === "fail") return `连不上：最近的连接全部失败（共 ${s.failed} 次），看下方失败原因，或换个节点再检测。`;
  if (s.health === "warn")
    return `部分失败：${s.total} 条连接里 ${s.failed} 条失败（成功率 ${rate}%），问题网站排在最前面。`;
  return `工作正常：${s.total} 条连接，成功率 ${rate}%${s.failed ? `，偶有 ${s.failed} 条失败` : ""}。`;
}

/** 内核报错 → 先说人话，原文放在后面给懂行的人看 */
const REASONS: [RegExp, string][] = [
  [/没有收到任何数据/, "对方一直没回应"],
  [/i\/o timeout|timed out|timeout/i, "连接超时"],
  [/refused/i, "对方拒绝连接"],
  [/no such host|lookup /i, "域名解析失败"],
  [/handshake/i, "加密握手失败"],
  [/unreachable|no route/i, "网络不可达"],
  [/QUIC/, "QUIC 按设计拦截，不影响使用"],
];

export function plainReason(reason: string | undefined): { short: string; detail: string } {
  if (!reason) return { short: "", detail: "" };
  const hit = REASONS.find(([re]) => re.test(reason));
  return { short: hit ? hit[1] : "连接出错", detail: reason };
}

export function rate(ok: number, failed: number): string {
  const n = ok + failed;
  return n ? `${Math.round((ok / n) * 100)}%` : "—";
}

/** 「12.3 秒」「2 分 05 秒」 */
export function duration(sec: number): string {
  if (!sec) return "—";
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)} 秒`;
  const m = Math.floor(sec / 60);
  return `${m} 分 ${String(Math.round(sec % 60)).padStart(2, "0")} 秒`;
}
