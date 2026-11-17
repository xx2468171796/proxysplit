/**
 * 支付通道异常（5.6，业主 11-04「以后新站接入零成本」）：站点只写**一个函数** `render(ui)`（用本站原生弹窗显示
 * `ui.title` + `ui.body` + 「我知道了」），其余由本模块判断。浏览器 / 游戏 overlay / Node 都能用，零依赖。
 *
 *   const pay = watchPayOutage(fetch, showOutage);      // 1. 包一层本站的支付请求 fetch：任何回包是「通道异常」就调 showOutage
 *   // 或逐个回包判断：if (guardPayOutage(reply, showOutage)) return;  // 已处理：关掉二维码 / 倒计时 / 排队
 *
 * 认得的回包：SitePay 的下单 / 继续支付拒绝（`code: "OUTAGE"` / `ui.kind: "outage"`）、查单 / 我已支付
 * （`outage: true`）、排队轮询（`outage: true`）、中心原始错误体（`code: "PAY_OUTAGE"`），以及包在 `data` / `error` /
 * `details` 里一层的同样结构。文案永远来自支付中心（业主在后台「通道异常提示」改）；中心没给文案时才用包里默认。
 */
import { type PayUi } from "../center/ui.ts";
export type PayOutageRenderer = (ui: PayUi) => void;
/** 这个回包（任意结构）是不是「支付通道异常」；是 → 要显示的 ui（中心文案），否 → null。纯函数。 */
export declare function payOutageOf(reply: unknown): PayUi | null;
/** 回包是通道异常 → 调 render 并返回 true（调用方停掉二维码 / 倒计时 / 排队 / 轮询）；否则 false。 */
export declare function guardPayOutage(reply: unknown, render: PayOutageRenderer): boolean;
/**
 * 包一层 fetch：匹配的请求（默认 URL 含 pay / recharge / order / queue）回 JSON 且是通道异常 → 调 render（同一段文案
 * 5 秒内只弹一次）。原回包照常返回给站点代码。只读不改请求，非 JSON 回包不碰。
 */
export declare function watchPayOutage(fetchImpl: typeof fetch, render: PayOutageRenderer, match?: (url: string) => boolean): typeof fetch;
export interface EnsurePayOpenOptions {
    /** fetch to use (default globalThis.fetch). */
    fetch?: typeof fetch;
    /** Give up and treat as open after this many ms (default 1500): a slow pre-check never blocks paying. */
    timeoutMs?: number;
}
/**
 * 5.16 付款前置检查（业主 11-04「点充值就立刻看到通道异常，不先弹支付须知 / 滑块 / 排队」）。
 * 点充值 / 确认金额的**第一行**调：
 *
 *   if (!(await ensurePayOpen("/api/pay/status", render))) return;   // 通道异常：已 render，停
 *   showPayNotice(); ...                                              // 正常：支付须知 → 滑块 → 下单
 *
 * `source` = 站点公开状态路由的 URL（站点后端原样回 `sitePay.payStatus()`），或返回回包的函数。
 * 回包是通道异常 → render(ui) 并返回 false；其他（正常 / 网络错 / 超时 / 非 JSON）→ true（不挡付款）。
 */
export declare function ensurePayOpen(source: string | (() => Promise<unknown>), render: PayOutageRenderer, options?: EnsurePayOpenOptions): Promise<boolean>;