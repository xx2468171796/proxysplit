/**
 * `zhifu/presentation` — how a pay link is shown to the payer (both pay modes, every channel). Owner 2026-11-05:
 * - every adapter DECLARES which link kinds it can return (`ChannelAdapter.links`), gets the payer's scene and the
 *   wanted kind in `CreateInput` (`scene` / `wantLink`) and says what it returned (`CreateResult.linkKind`);
 * - ONE scene detector (server UA + client hints) and ONE policy live here: desktop → scannable QR; phone → a jump
 *   button the player taps (never an automatic redirect) + the 「截图扫码」 line under it, QR stays visible;
 * - the QR mode and the hint copy are editable per channel (rule) and per site (site config); site wins.
 * A new channel plugs in by declaring `links` and honouring `wantLink`; a new site by using the site helpers
 * (`payJump` / `openPayLink`). Pure, framework-free.
 */
export const PAY_LINK_KINDS = ["h5", "alipay_qr", "page", "wx_qr", "wx_h5"];
export const QR_MODES = ["all", "desktop", "off"];
/** Default when neither site nor channel sets it (owner 11-05: one link that is QR, screenshot-QR and jump). */
export const DEFAULT_QR_MODE = "all";
/** Owner 11-05 wording; the line under the phone jump button (editable per channel / site: `jumpHint`). */
export const DEFAULT_JUMP_HINT = "跳转不了？可以截图保存二维码，在支付宝里从相册扫码付款";
export const JUMP_HINT_MAX = 120;
/** 6.11 owner 11-10 wording: what a phone player does with a WeChat Pay QR (no jump exists for WeChat). */
/**
 * 6.13.1 owner 11-10 19:00: WeChat refuses album recognition of a pay code, so the phone copy asks for a CAMERA scan
 * from another device (no album instructions).
 */
export const WX_SCREENSHOT_GUIDE = "微信不支持识别本机相册里的付款码。请长按保存或截图，发到另一台手机或电脑上打开，再用本机微信「扫一扫」扫屏幕付款；也可以直接让朋友用微信扫这个码";
export const WX_OTHER_DEVICE_TITLE = "请用另一台手机的微信扫码付款";
/** 6.12 owner 11-10: the line under the phone button that opens the upstream WeChat page (`wx_h5`). */
export const WX_JUMP_HINT = "打开后长按二维码保存，再用微信扫一扫 → 相册";
/** site > channel > defaults. Pure. */
export function resolvePresentation(site, channel) {
    return {
        qrMode: site?.qrMode ?? channel?.qrMode ?? DEFAULT_QR_MODE,
        jumpHint: site?.jumpHint?.trim() || channel?.jumpHint?.trim() || DEFAULT_JUMP_HINT,
    };
}
const IN_APP = /alipayclient|micromessenger|\bqq\/|weibo|dingtalk|aweme|newsarticle|baiduboxapp|xhsdiscover/i;
const PHONE = /iphone|ipod|android|harmonyos|openharmony|mobile/i;
/**
 * The payer's scene from the UA + client hints. In-app browsers (Alipay / WeChat …) and phones = mobile; an iPad
 * UA, or a Mac UA with touch, = tablet; any other UA = desktop; no UA = unknown. Pure.
 */
export function detectPayScene(h) {
    const ua = (h.userAgent ?? "").trim();
    if (!ua)
        return "unknown";
    if (IN_APP.test(ua))
        return "mobile";
    if (/ipad/i.test(ua))
        return "tablet"; // before PHONE: iPad UAs carry "Mobile/…"
    if (PHONE.test(ua))
        return "mobile";
    const touch = h.touchHint === true || (h.maxTouchPoints ?? 0) > 1;
    return touch && /macintosh/i.test(ua) ? "tablet" : "desktop";
}
/**
 * Which link kind to ask the adapter for; null = its default. The official QR link goes to every scene under
 * "all", to desktop only under "desktop", never under "off" or when the adapter has none. Pure.
 */
export function wantLink(scene, links, qrMode) {
    // The channel's QR kind: Alipay's official link, or the WeChat Pay code (same qrMode rules, 6.12).
    const qr = links?.includes("alipay_qr") ? "alipay_qr" : links?.includes("wx_qr") ? "wx_qr" : null;
    if (!qr || qrMode === "off")
        return null;
    // A QR-only WeChat account (payMethod qr) has nothing else to give: QR in every scene.
    if (qr === "wx_qr" && !links?.includes("wx_h5"))
        return "wx_qr";
    return qrMode === "all" || scene === "desktop" ? qr : null;
}
/** https on alipay.com or one of its subdomains — the only links accepted as `alipay_qr`. Pure. */
export function isAlipayOfficialLink(url) {
    if (!url)
        return false;
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        return u.protocol === "https:" && (host === "alipay.com" || host.endsWith(".alipay.com"));
    }
    catch {
        return false;
    }
}
/** WeChat Pay hosts only (not mp.weixin.qq.com etc., which anyone can publish on). */
const WX_HOSTS = new Set(["wx.tenpay.com", "payapp.weixin.qq.com", "payapp.wechatpay.cn"]);
/** A nested URL (plain or percent-encoded) inside the query — the only way another site could ride along. */
/** `weixin://wxpay/bizpayurl` with an optional query only — no credentials, port, extra path or fragment. */
const WEIXIN_NATIVE = /^weixin:\/\/wxpay\/bizpayurl(\?[^\s#]*)?$/i;
const NESTED_URL = /(?:https?|ftp):|%3a%2f%2f|\/\//i;
/**
 * WeChat Pay's official native-pay link — the only links accepted as `wx_qr`: `weixin://wxpay/bizpayurl?…`, or
 * https on wx.tenpay.com / payapp.weixin.qq.com / payapp.wechatpay.cn (exact hosts, default port). Any nested URL in
 * the path, query or fragment is refused, so a link can never carry another site (ours included) to WeChat. Pure.
 */
export function isWechatOfficialLink(url) {
    if (!url)
        return false;
    // weixin: is matched on the raw string: Chromium < 130 (old Android WebViews, HarmonyOS ArkWeb in the Baidu app)
    // parses non-special URLs as opaque (empty hostname), which made every valid code show 「付款码暂不可用」.
    const wx = WEIXIN_NATIVE.exec(url);
    if (wx)
        return !NESTED_URL.test(wx[1] ?? "");
    try {
        const u = new URL(url);
        const rest = `${u.pathname.slice(1)}${u.search}${u.hash}`;
        if (NESTED_URL.test(rest) || u.username || u.password)
            return false;
        if (u.protocol === "weixin:")
            return false;
        return u.protocol === "https:" && !u.port && WX_HOSTS.has(u.hostname.toLowerCase());
    }
    catch {
        return false;
    }
}
/**
 * An upstream https pay page we may hand to the player (`wx_h5`): https, default port, no credentials and no nested
 * URL anywhere after the host — so it can never carry another site (ours included). Pure.
 */
export function isUpstreamPayPage(url) {
    if (!url)
        return false;
    try {
        const u = new URL(url);
        if (u.protocol !== "https:" || u.port || u.username || u.password)
            return false;
        return !NESTED_URL.test(`${u.pathname.slice(1)}${u.search}${u.hash}`);
    }
    catch {
        return false;
    }
}
/** Kind of a stored link: the adapter's word when given, else official Alipay → alipay_qr, WeChat → wx_qr, else h5. Pure. */
export function linkKindOf(url, declared) {
    if (!url)
        return null;
    if (declared && PAY_LINK_KINDS.includes(declared))
        return declared;
    if (isWechatOfficialLink(url))
        return "wx_qr";
    return isAlipayOfficialLink(url) ? "alipay_qr" : "h5";
}
/**
 * Contract check of one create result against the adapter's declaration (framework-free; [] = OK): links are
 * declared; the returned kind is declared; an `alipay_qr` link is an official Alipay https link; a wanted kind the
 * adapter declares was honoured.
 */
export function presentationProblems(adapter, wanted, result) {
    if (!adapter.links?.length)
        return ["适配器没有声明能返回的链接类型（links）"];
    if (!result.ok || !result.payUrl)
        return [];
    const out = [];
    const kind = result.linkKind;
    if (!kind)
        out.push("建单结果没有标明链接类型（linkKind）");
    else if (!adapter.links.includes(kind))
        out.push(`返回了未声明的链接类型 ${kind}`);
    if (kind === "alipay_qr" && !isAlipayOfficialLink(result.payUrl))
        out.push(`alipay_qr 链接不是支付宝官方 https 域名：${result.payUrl}`);
    if (kind === "wx_h5" && !isUpstreamPayPage(result.payUrl))
        out.push(`wx_h5 链接必须是上游 https 付款页且不带其它网址：${result.payUrl}`);
    if (kind === "wx_qr" && !isWechatOfficialLink(result.payUrl))
        out.push(`wx_qr 链接不是微信支付官方链接（weixin://wxpay/bizpayurl 或 wx.tenpay.com / payapp.weixin.qq.com）：${result.payUrl}`);
    if (wanted && adapter.links.includes(wanted) && kind !== wanted)
        out.push(`要的是 ${wanted}，返回了 ${kind ?? "未标明"}`);
    return out;
}
/** `/qr/<token>.png` — the only image path accepted from an upstream WeChat page (6.13). */
const QR_IMG_SRC = /<img\b[^>]*\bsrc\s*=\s*["'](\/qr\/[A-Za-z0-9_-]{4,128}\.png)["']/gi;
/**
 * The single QR image of an upstream WeChat pay page (`wx_h5`), as an absolute URL on the page's OWN host; null when
 * the page is not a clean upstream page or has zero / several such images (never guess). Pure.
 */
export function upstreamQrImageUrl(html, pageUrl) {
    if (!isUpstreamPayPage(pageUrl))
        return null;
    const found = new Set([...html.slice(0, 200000).matchAll(QR_IMG_SRC)].map((m) => m[1]));
    if (found.size !== 1)
        return null;
    return new URL([...found][0], new URL(pageUrl).origin).href;
}
/** Max PNG bytes accepted for the overlay QR image. */
export const QR_IMAGE_MAX_BYTES = 100000;
/** PNG signature + size cap → `data:image/png;base64,…`; null otherwise. Pure. */
export function pngDataUrl(bytes, contentType) {
    if (!/^image\/png\b/i.test(contentType ?? "") || bytes.length < 8 || bytes.length >= QR_IMAGE_MAX_BYTES)
        return null;
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!sig.every((b, i) => bytes[i] === b))
        return null;
    return `data:image/png;base64,${base64(bytes)}`;
}
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Standard base64 (no Buffer / btoa: this module also ships in the browser overlay). Pure. */
function base64(b) {
    let out = "";
    for (let i = 0; i < b.length; i += 3) {
        const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
        out += i + 1 < b.length ? B64[(n >> 6) & 63] : "=";
        out += i + 2 < b.length ? B64[n & 63] : "=";
    }
    return out;
}
