// 发短信验证码前的人机验证（公司统一验证组件）。官网和验证组件同源，直接加载它的 hook.js 调 LcVerify.open，
// 拿到一次性凭证后随发码请求交给服务端（凭证绑定本站域名 + 用途 sms，用一次就作废）。

type LcVerifyApi = { open: (opts: { action: string }) => Promise<unknown> };
declare global {
  interface Window {
    LcVerify?: LcVerifyApi;
  }
}

const HOOK_SRC = "/__leichiwaf/hv/hook.js";
const HOOK_TIMEOUT_MS = 8000;
const MAX_TOKEN = 1024;

/** 结果：拿到凭证 / 用户取消（不发请求） / 验证组件没起来（不带凭证发，服务端怎么说就给用户看什么）。 */
export type VerifyResult = { kind: "token"; token: string } | { kind: "cancelled" } | { kind: "unavailable" };

let loading: Promise<boolean> | null = null;

/** 边缘一般已经把 hook.js 注入页面；没有就自己加载一次。加载失败下次点击再试。 */
function loadHook(): Promise<boolean> {
  if (window.LcVerify) return Promise.resolve(true);
  loading ??= new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      if (!ok) loading = null;
      resolve(ok);
    };
    const timer = setTimeout(() => done(Boolean(window.LcVerify)), HOOK_TIMEOUT_MS);
    const s = document.createElement("script");
    s.src = HOOK_SRC;
    s.async = true;
    s.onload = () => done(Boolean(window.LcVerify));
    s.onerror = () => done(false);
    document.head.appendChild(s);
  });
  return loading;
}

export async function openSmsVerify(): Promise<VerifyResult> {
  if (!(await loadHook()) || !window.LcVerify) return { kind: "unavailable" };
  try {
    const token = await window.LcVerify.open({ action: "sms" });
    return typeof token === "string" && token && token.length <= MAX_TOKEN
      ? { kind: "token", token }
      : { kind: "unavailable" };
  } catch (e) {
    // 组件的拒绝原因：cancelled = 用户点了取消；timeout / no body = 验证页没加载出来
    const reason = String((e as { message?: unknown } | null)?.message ?? "");
    return reason === "timeout" || reason === "no body" ? { kind: "unavailable" } : { kind: "cancelled" };
  }
}
