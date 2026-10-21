// 官网与商业 API（同域 /v1）之间的全部往来：访客统计、下载地址、最新版本、套餐、网页注册。
// 页面组件只调这里，不直接 fetch。

export type Plan = {
  code: string;
  name: string;
  tier: "standard" | "premium" | string;
  priceCents: number;
  originalPriceCents?: number;
  durationDays?: number;
  lifetime?: boolean;
  maxDevices: number;
  badge?: string;
  description?: string;
  saleEndsAt?: string;
  purchaseLimitPerUser?: number;
};

const VISITOR_KEY = "proxysplit:visitor";
const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** 匿名访客 ID：只用于下载 / 浏览量按人去重，存在本机。 */
function visitorId(): string {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return "";
  }
}

const VISITOR = visitorId();

/** 下载走 /v1/download/<file>?v=<访客>：服务端记一次后 302 到真实文件。 */
const downloadUrl = (file: string) => `/v1/download/${file}?v=${encodeURIComponent(VISITOR)}`;
export const LATEST_DOWNLOAD = downloadUrl("proxysplit-latest.exe");

export function trackView(): void {
  if (import.meta.env.DEV) return;
  void fetch("/v1/track/view", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ visitorId: VISITOR, path: location.pathname + location.search, referer: document.referrer }),
    keepalive: true,
  }).catch(() => undefined);
}

/** 最新正式版本号；拿不到返回 null（页面继续用 latest 下载地址）。 */
export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch("/v1/releases/latest", { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { release?: { version?: unknown } };
    const v = body.release?.version;
    return typeof v === "string" && VERSION_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export async function fetchPlans(): Promise<Plan[]> {
  const res = await fetch("/v1/catalog/plans", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const body = (await res.json()) as { items?: Plan[] };
  return Array.isArray(body.items) ? body.items : [];
}

export type RegisterInput = { username: string; email: string; password: string };

/** 网页注册只建账号；试用在第一次用客户端登录时按硬件发放。返回空串 = 成功。 */
export async function registerWeb(input: RegisterInput): Promise<string> {
  try {
    const res = await fetch("/v1/auth/register/web", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.ok) return "";
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return body.error?.message || "注册失败，请稍后重试。";
  } catch {
    return "网络异常，请稍后重试。";
  }
}

export function validateRegister(input: RegisterInput): string {
  if (input.username.length < 3 || /[\s@]/.test(input.username)) return "用户名至少 3 位，不能有空格和 @。";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return "邮箱格式不对。";
  if (input.password.length < 8) return "密码至少 8 位。";
  return "";
}

export const yuan = (cents: number | undefined) => (Number(cents ?? 0) / 100).toFixed(2);
