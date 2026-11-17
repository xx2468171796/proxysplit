/** Small self-contained Chinese status page (no scripts, no external assets, nothing about the order). */
export declare function statusPage(title: string, text: string, retryHref?: string | null): string;
/**
 * Upstream hand-off page (章鱼哥 11-04: 「直接 location.href = pay_url 这样跳，否则会穿透到支付宝」). The upstream
 * pay page carries its own jump code into Alipay and expects a normal page navigation, never our HTTP 302. No
 * referrer (meta + header), nothing about the order, the URL embedded as a JSON string with `<` escaped.
 */
export declare function jumpPage(url: string): string;
/** Headers for every `/s/` response: no cache, no referrer (the upstream cashier must not learn the token). */
export declare const HANDOFF_HEADERS: Readonly<Record<string, string>>;