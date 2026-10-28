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
export const MAC_DOWNLOAD = downloadUrl("proxysplit-macos-latest.zip");

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

export type RegisterInput = { phone: string; code: string; username: string; password: string; ref?: string };

// 推广链接 ?ref=CODE：落地时记 30 天（新码覆盖旧码），注册时带上，服务端在建号事务里绑上级（多级分销）。
const REF_KEY = "proxysplit:ref";
const REF_TTL_MS = 30 * 86_400_000;
const REF_RE = /^[A-Za-z0-9]{4,16}$/;

export function captureReferralCode(): void {
  try {
    const code = new URLSearchParams(location.search).get("ref")?.trim() ?? "";
    if (REF_RE.test(code)) localStorage.setItem(REF_KEY, JSON.stringify({ code: code.toUpperCase(), at: Date.now() }));
  } catch {
    /* 隐私模式没有 localStorage：只是不记 */
  }
}

export function readReferralCode(): string {
  try {
    const v = JSON.parse(localStorage.getItem(REF_KEY) ?? "null") as { code?: string; at?: number } | null;
    return v?.code && v.at && Date.now() - v.at < REF_TTL_MS ? v.code : "";
  } catch {
    return "";
  }
}

/** 服务端错误码 → 中文提示。没认出的码用服务端自带的 message，再没有就用兜底文案。 */
const ERROR_TEXT: Record<string, string> = {
  PHONE_TAKEN: "这个手机号已经注册过了，请直接下载软件登录。",
  SMS_COOLDOWN: "验证码发送太频繁，请 60 秒后再试。",
  SMS_DAILY_LIMIT: "这个手机号今天获取验证码的次数已达上限，请明天再试。",
  SMS_UNAVAILABLE: "短信服务暂时不可用，请稍后再试。",
  SMS_SEND_FAILED: "短信发送失败，请稍后再试。",
  SMS_CODE_INVALID: "验证码不对或已过期，请重新获取。",
  IDENTITY_TAKEN: "这个用户名已经被注册了，换一个试试。",
  REGISTRATION_DISABLED: "当前暂停开放注册，请稍后再来。",
  IP_ACCOUNT_LIMIT: "当前网络注册的账号已达上限，请直接登录或联系客服。",
  DEVICE_ACCOUNT_LIMIT: "该设备注册的账号已达上限，请使用已有账号登录。",
  VALIDATION_ERROR: "填写的内容格式不对，请检查手机号、验证码、用户名和密码。",
  RATE_LIMITED: "操作太频繁了，请稍后再试。",
};

type PostResult = { ok: true; data: unknown } | { ok: false; code: string; message: string };

async function postJson(path: string, body: unknown): Promise<PostResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data };
    const err = (data as { error?: { code?: string; message?: string } }).error;
    const code = err?.code ?? "";
    return { ok: false, code, message: ERROR_TEXT[code] || err?.message || "请求失败，请稍后重试。" };
  } catch {
    return { ok: false, code: "NETWORK", message: "网络异常，请稍后重试。" };
  }
}

export const SMS_COOLDOWN_FALLBACK = 60;

/** 发注册验证码。成功返回冷却秒数；限频报错时也返回要等的秒数，页面照样倒计时。 */
export async function sendRegisterCode(phone: string): Promise<{ cooldown: number; error: string }> {
  const r = await postJson("/v1/auth/sms/send", { phone, purpose: "register" });
  if (!r.ok) return { cooldown: r.code === "SMS_COOLDOWN" ? SMS_COOLDOWN_FALLBACK : 0, error: r.message };
  const s = (r.data as { cooldownSeconds?: unknown }).cooldownSeconds;
  return { cooldown: typeof s === "number" && s > 0 ? Math.ceil(s) : SMS_COOLDOWN_FALLBACK, error: "" };
}

/** 网页注册只建账号；试用在第一次用客户端登录时按硬件发放。返回空串 = 成功。 */
export async function registerWeb(input: RegisterInput): Promise<string> {
  const r = await postJson("/v1/auth/register/web", input);
  return r.ok ? "" : r.message || "注册失败，请稍后重试。";
}

/** 去掉空格 / 横线和 +86 前缀，和服务端的手机号规则一致。 */
export function normalizePhone(raw: string): string {
  const s = raw.replace(/[\s\-()]/g, "");
  if (s.startsWith("+86")) return s.slice(3);
  if (s.startsWith("0086")) return s.slice(4);
  if (s.length === 13 && s.startsWith("86")) return s.slice(2);
  return s;
}

export const isPhone = (phone: string) => /^1[3-9]\d{9}$/.test(phone);

export function validateRegister(input: RegisterInput): string {
  if (!isPhone(input.phone)) return "请输入正确的 11 位手机号。";
  if (!/^\d{6}$/.test(input.code)) return "请输入 6 位数字验证码。";
  if (input.username.length < 3 || /[\s@]/.test(input.username)) return "用户名至少 3 位，不能有空格和 @。";
  if (input.password.length < 8) return "密码至少 8 位。";
  return "";
}

export const yuan = (cents: number | undefined) => (Number(cents ?? 0) / 100).toFixed(2);
