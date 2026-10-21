// 纯展示格式化：无副作用，单测覆盖（format.test.ts）。

/** 速率自适应单位：慢速时显示 KB/s、B/s，而不是 0.00 MB/s。 */
export function fmtRate(bps: number): { value: string; unit: string } {
  if (!(bps > 0)) return { value: "0.00", unit: "MB/s" };
  if (bps >= 1024 * 1024) return { value: (bps / 1048576).toFixed(2), unit: "MB/s" };
  if (bps >= 1024) return { value: (bps / 1024).toFixed(1), unit: "KB/s" };
  return { value: Math.round(bps).toString(), unit: "B/s" };
}

export function fmtUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":");
}

export function fmtBytes(n: number): string {
  if (!(n > 0)) return "0";
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)}M`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}K`;
  return `${n}B`;
}

/** 金额：分 → 「12.00」（不经浮点累加，只做一次除法展示）。 */
export function fmtYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function fmtDateTime(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "—" : t.toLocaleString();
}

/** Google 延迟：-99 检测中，<0 不通，0/未定义 未检测。 */
export function latencyText(ms?: number): string {
  if (ms === -99) return "检测中…";
  if (ms === undefined || ms === 0) return "未检测";
  if (ms < 0) return "Google 不通";
  return `${ms} ms`;
}

export function tcpLatencyText(ms?: number): string {
  if (ms === -99) return "检测中…";
  if (ms === undefined || ms === 0) return "未检测";
  if (ms < 0) return "TCP 不通";
  return `${ms} ms`;
}

/** 应用连通测试结果：-99 测试中，0 直连，-2 拦截，其余负数不通。 */
export function appLatencyText(ms: number | undefined): string {
  if (ms === undefined) return "测试";
  if (ms === -99) return "测试中…";
  if (ms === 0) return "直连";
  if (ms === -2) return "拦截";
  if (ms < 0) return "不通";
  return `${ms} ms`;
}

/** 延迟分档：0 未知 / 不通，1 慢 … 4 快。 */
export function latencyGrade(ms?: number): 0 | 1 | 2 | 3 | 4 {
  if (!ms || ms < 0) return 0;
  if (ms < 80) return 4;
  if (ms < 130) return 3;
  if (ms < 200) return 2;
  return 1;
}

export function baseName(s: string): string {
  return (s || "").split(/[\\/]/).pop() || s;
}

/** 逗号 / 空格 / 换行分隔的文本 → 去空项的数组。 */
export function parseList(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function remainingLabel(expiresAt: string, planCode = "", now = Date.now()): string {
  if (planCode.includes("lifetime") || planCode === "admin") return "永久有效";
  if (!expiresAt) return "未开通";
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "已到期";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.max(1, Math.ceil((ms % 86_400_000) / 3_600_000));
  return days > 0 ? `剩余 ${days} 天 ${hours} 小时` : `剩余 ${hours} 小时`;
}

export type ParsedLog = { time: string; level: string; tag: string; msg: string };

const LEVEL_RE = /^\s*(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|PANIC)\b/i;

/** 一行原始日志 → 时间 / 级别 / 标签 / 正文；内核没打级别时按关键字推断。 */
export function parseLog(raw: string): ParsedLog {
  const s = raw.replace(/\s+$/, "");
  const time = s.match(/(\d{2}:\d{2}:\d{2})/)?.[1] ?? "";
  // sing-box 行首是「+0800 2026-10-22 12:34:56」：先去时区，再去日期时间。
  let body = s
    .replace(/^\s*[+-]\d{4}\s+/, "")
    .replace(/^\s*\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*/, "")
    .replace(/^\s*\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*/, "");
  const lv = body.match(LEVEL_RE);
  let level = lv?.[1]?.toUpperCase() ?? "";
  if (lv) body = body.slice(lv[0].length);
  body = body.replace(/^[:\s]+/, "");
  let tag = "";
  const tg = body.match(/^\[([^\]]+)\]\s*/);
  if (tg) {
    tag = tg[1] ?? "";
    body = body.slice(tg[0].length);
  }
  const msg = body.trim() || s.trim();
  if (!level) level = inferLevel(msg);
  if (level === "WARNING") level = "WARN";
  return { time, level, tag, msg };
}

function inferLevel(msg: string): string {
  if (/error|fail|失败|拒绝|无法|panic/i.test(msg)) return "ERROR";
  if (/warn|warning|超时|timeout|重试|抓不到/i.test(msg)) return "WARN";
  return "INFO";
}

/** sing-box 输出带 ANSI 颜色码，去掉后再展示。 */
export function stripAnsi(line: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 正是要匹配 ESC 控制符
  return line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}
