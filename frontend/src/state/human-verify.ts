// 人机验证（公司雷池 hv，LcVerify）：付款前（用途 pay）和发短信验证码前（用途 sms）共用。
// hook.js 只认同源（验证页 iframe 是相对路径、postMessage 只发给同源父页面），Wails 页面的 origin 不是站点域名，
// 所以盖一层全屏 iframe 加载官网上的中继页 /pay-verify.html?action=<用途>：它在站点同源里调 LcVerify.open，
// 拿到一次性凭证后 postMessage 回到这里（带本次 nonce 和用途）。凭证绑定站点域名 + 用途，只交给后端去核销。

export const HUMAN_VERIFY_ORIGIN = "https://proxysplit.zygskins.cn";
const READY_TIMEOUT_MS = 12000;
/** 凭证长度上限（超了当没拿到） */
const MAX_TOKEN = 1024;

/** 中继页认的用途白名单（website/public/pay-verify.html 同一份）。 */
export type HumanVerifyAction = "pay" | "sms" | "register" | "reset";

/** 结果：拿到凭证 / 用户取消（不发请求） / 验证页没起来（不带凭证发，由服务端决定）。 */
export type HumanVerifyResult = { kind: "token"; token: string } | { kind: "cancelled" } | { kind: "unavailable" };

type RelayMessage = { type?: unknown; nonce?: unknown; action?: unknown; token?: unknown; reason?: unknown };

/**
 * 解析中继页消息：来源、nonce 对不上一律忽略（null）；ready 返回 "ready"。
 * 用途对不上的凭证不能用：老版本中继页不认 action 参数、一律按 pay 出题（消息里也不带 action），
 * 拿它的凭证去发短信必然被拒，所以当作「验证页没起来」。
 */
export function readRelayMessage(
  origin: string,
  data: unknown,
  nonce: string,
  action: HumanVerifyAction = "pay",
): HumanVerifyResult | "ready" | null {
  if (origin !== HUMAN_VERIFY_ORIGIN || !data || typeof data !== "object") return null;
  const m = data as RelayMessage;
  if (m.nonce !== nonce) return null;
  if (m.type === "ps-hv-error") return UNAVAILABLE;
  if (m.type === "ps-hv-cancel") {
    // hook.js 的 reject 原因：cancelled = 用户点了取消；timeout / no body = 验证页没加载出来
    return m.reason === "timeout" || m.reason === "no body" ? UNAVAILABLE : { kind: "cancelled" };
  }
  if (m.type !== "ps-hv-ready" && m.type !== "ps-hv-ok") return null;
  if (!sameAction(m.action, action)) return UNAVAILABLE;
  if (m.type === "ps-hv-ready") return "ready";
  return usableToken(m.token) ? { kind: "token", token: m.token } : UNAVAILABLE;
}

const UNAVAILABLE: HumanVerifyResult = { kind: "unavailable" };
const sameAction = (got: unknown, want: HumanVerifyAction) => got === want || (got === undefined && want === "pay");
const usableToken = (t: unknown): t is string => typeof t === "string" && t.length > 0 && t.length <= MAX_TOKEN;

function newNonce(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 发短信验证码时服务端的错误码：没带凭证，或凭证过期 / 被判无效。 */
export const CAPTCHA_REQUIRED = "CAPTCHA_REQUIRED";

type Outcome = { errCode?: string };

/**
 * 先验证再执行 run（下单 / 发验证码）。取消验证 = 不执行（null）。
 * 验证页没起来就不带凭证执行，由服务端决定，结果原样返回（服务端拒绝就是拒绝，这里不改写成成功）。
 * 带了凭证服务端仍回 retryCode（凭证过期 / 被判无效）就再验一次、重来一次，最多一次，避免死循环。
 */
export async function withHumanVerify<R extends Outcome>(
  retryCode: string,
  run: (token: string) => Promise<R>,
  verify: () => Promise<HumanVerifyResult>,
): Promise<R | null> {
  let last: R | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const v = await verify();
    if (v.kind === "cancelled") return last;
    last = await run(v.kind === "token" ? v.token : "");
    if (last.errCode !== retryCode || v.kind !== "token") return last;
  }
  return last;
}

let active: (() => void) | null = null;

/** 打开验证层，等中继页回结果。同一时间只有一层。 */
export function openHumanVerify(action: HumanVerifyAction): Promise<HumanVerifyResult> {
  active?.();
  return new Promise((resolve) => {
    const nonce = newNonce();
    const frame = document.createElement("iframe");
    frame.src = `${HUMAN_VERIFY_ORIGIN}/pay-verify.html?n=${nonce}&action=${action}`;
    frame.title = "安全验证";
    frame.setAttribute("allowtransparency", "true");
    frame.style.cssText =
      "pointer-events:auto;position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;padding:0;z-index:2147483647;background:transparent;color-scheme:normal";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (r: HumanVerifyResult) => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      if (active === cancel) active = null;
      resolve(r);
    };
    const cancel = () => finish({ kind: "cancelled" });
    function onMessage(e: MessageEvent) {
      if (e.source !== frame.contentWindow) return;
      const r = readRelayMessage(e.origin, e.data, nonce, action);
      if (r === "ready") {
        if (timer) clearTimeout(timer);
        timer = null;
      } else if (r) finish(r);
    }
    window.addEventListener("message", onMessage);
    timer = setTimeout(() => finish({ kind: "unavailable" }), READY_TIMEOUT_MS);
    active = cancel;
    document.body.appendChild(frame);
  });
}
