/**
 * The two pages `/s/` ever renders (both pay modes): a self-contained status page and the upstream hand-off page
 * (`location.href`, never an HTTP 302; no referrer). Send them with `HANDOFF_HEADERS`.
 */
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
/** Small self-contained Chinese status page (no scripts, no external assets, nothing about the order). */
export function statusPage(title, text, retryHref = null) {
    const t = escapeHtml(title);
    const retry = retryHref ? `<p><a href="${escapeHtml(retryHref)}">重新打开</a></p>` : "";
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${t}</title><style>body{margin:0;font:16px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
background:#f5f6f8;color:#222;display:flex;min-height:100vh;align-items:center;justify-content:center}
a{display:inline-block;margin-top:16px;padding:8px 24px;border-radius:6px;background:#1677ff;color:#fff;
text-decoration:none}main{background:#fff;border-radius:12px;padding:32px 24px;margin:16px;max-width:360px;text-align:center;
box-shadow:0 2px 12px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 12px}p{margin:0;color:#555}</style></head>
<body><main><h1>${t}</h1><p>${escapeHtml(text)}</p>${retry}</main></body></html>`;
}
/**
 * Upstream hand-off page (章鱼哥 11-04: 「直接 location.href = pay_url 这样跳，否则会穿透到支付宝」). The upstream
 * pay page carries its own jump code into Alipay and expects a normal page navigation, never our HTTP 302. No
 * referrer (meta + header), nothing about the order, the URL embedded as a JSON string with `<` escaped.
 */
export function jumpPage(url) {
    const js = JSON.stringify(url).replace(/</g, "\\u003c");
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer"><title>正在打开支付</title></head>
<body style="font:16px/1.6 -apple-system,'PingFang SC',sans-serif;text-align:center;padding-top:30vh;color:#555">
正在打开支付…<script>location.href=${js};</script>
<noscript><a href="${escapeHtml(url)}" rel="noreferrer">点此继续支付</a></noscript></body></html>`;
}
/** Headers for every `/s/` response: no cache, no referrer (the upstream cashier must not learn the token). */
export const HANDOFF_HEADERS = {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex",
};
