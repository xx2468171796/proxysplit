// 付款前人机验证（公司雷池 hv，LcVerify action=pay）。
// hook.js 只认同源（验证页 iframe 是相对路径、postMessage 只发给同源父页面），Wails 页面的 origin 不是站点域名，
// 所以盖一层全屏 iframe 加载官网上的中继页 /pay-verify.html：它在站点同源里调 LcVerify.open，拿到一次性凭证后
// postMessage 回到这里（带本次 nonce）。凭证绑定站点域名 + action，只交给后端，由支付中心 SDK 兑换。

export const PAY_VERIFY_ORIGIN = "https://proxysplit.zygskins.cn";
const READY_TIMEOUT_MS = 12000;

/** 结果：拿到凭证 / 玩家取消（不下单） / 验证页没起来（不阻断，交给服务端决定）。 */
export type PayVerifyResult = { kind: "token"; token: string } | { kind: "cancelled" } | { kind: "unavailable" };

type RelayMessage = { type?: unknown; nonce?: unknown; token?: unknown; reason?: unknown };

/** 解析中继页消息：来源、nonce 对不上一律忽略（null）；ready 返回 "ready"。 */
export function readRelayMessage(origin: string, data: unknown, nonce: string): PayVerifyResult | "ready" | null {
  if (origin !== PAY_VERIFY_ORIGIN || !data || typeof data !== "object") return null;
  const m = data as RelayMessage;
  if (m.nonce !== nonce) return null;
  if (m.type === "ps-hv-ready") return "ready";
  if (m.type === "ps-hv-ok") {
    return typeof m.token === "string" && m.token && m.token.length <= 512
      ? { kind: "token", token: m.token }
      : { kind: "unavailable" };
  }
  if (m.type === "ps-hv-error") return { kind: "unavailable" };
  if (m.type === "ps-hv-cancel") {
    // hook.js 的 reject 原因：cancelled = 玩家点了取消；timeout / no body = 验证页没加载出来
    return m.reason === "timeout" || m.reason === "no body" ? { kind: "unavailable" } : { kind: "cancelled" };
  }
  return null;
}

function newNonce(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const CHALLENGE_REQUIRED = "PAY_CHALLENGE_REQUIRED";

type Created = { errCode?: string };

/**
 * 先验证再下单。取消验证 = 不下单（null）。验证页没起来就不带凭证下单，由支付中心决定（关了「每笔都验」照常能付）。
 * 中心仍回 PAY_CHALLENGE_REQUIRED（凭证过期 / 被判无效）就再弹一次、重下一次，最多一次，避免死循环。
 */
export async function placeVerifiedOrder<R extends Created>(
  create: (hvToken: string) => Promise<R>,
  verify: () => Promise<PayVerifyResult> = openPayVerify,
): Promise<R | null> {
  let last: R | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const v = await verify();
    if (v.kind === "cancelled") return last;
    last = await create(v.kind === "token" ? v.token : "");
    if (last.errCode !== CHALLENGE_REQUIRED || v.kind !== "token") return last;
  }
  return last;
}

let active: (() => void) | null = null;

/** 打开验证层，等中继页回结果。同一时间只有一层。 */
export function openPayVerify(): Promise<PayVerifyResult> {
  active?.();
  return new Promise((resolve) => {
    const nonce = newNonce();
    const frame = document.createElement("iframe");
    frame.src = `${PAY_VERIFY_ORIGIN}/pay-verify.html?n=${nonce}`;
    frame.title = "安全验证";
    frame.setAttribute("allowtransparency", "true");
    frame.style.cssText =
      "pointer-events:auto;position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;padding:0;z-index:2147483647;background:transparent;color-scheme:normal";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (r: PayVerifyResult) => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      frame.remove();
      if (active === cancel) active = null;
      resolve(r);
    };
    const cancel = () => finish({ kind: "cancelled" });
    function onMessage(e: MessageEvent) {
      if (e.source !== frame.contentWindow) return;
      const r = readRelayMessage(e.origin, e.data, nonce);
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
