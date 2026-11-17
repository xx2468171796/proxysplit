/** 跳转按钮 + 打开付款链接（6.2 付款展示标准：只在玩家点按时跳，不带 Referer，不拼深链）。 */
import { buildPayEntry } from "../payway/index.js";
import { PAY_COPY } from "./pay-copy.js";
/**
 * 跳转按钮：规则同 buildPayEntry（5ff / 5e 线上验证过），文案统一成 PAY_COPY。
 * 6.2（业主 11-05，付款展示标准 zhifu/presentation）：手机 = 玩家**点按钮**才跳（出码后不自动跳；`openPayLink`
 * 对刚发出的链接的自动调用直接忽略），按钮下方常驻 `hint`（中心下发的 `jumpHint`，站点 > 通道 > 默认），二维码照常显示
 * 给「截图到相册再扫」兜底；电脑 = 只显示二维码。
 */
export function payJump(opts) {
    const e = buildPayEntry({ payUrl: opts.payUrl, checkoutUrl: opts.checkoutUrl, linkKind: opts.linkKind, env: { userAgent: opts.userAgent, maxTouchPoints: opts.maxTouchPoints } });
    if (e.href && e.isMobile)
        markHandedOut(e.href);
    return {
        href: e.href,
        label: e.href ? (opts.linkKind === "wx_h5" ? PAY_COPY.wxJumpButton : PAY_COPY.jumpButton) : "",
        guide: e.guide,
        fallback: e.href ? (opts.linkKind === "wx_h5" ? PAY_COPY.wxJumpHint : opts.hint?.trim() || PAY_COPY.jumpFallback) : null,
        isMobile: e.isMobile,
    };
}
/**
 * 自动跳转护栏（6.2）：payJump 刚给出手机跳转链接后 AUTO_OPEN_GUARD_MS 内、又不在玩家真实点击事件里的
 * `openPayLink(同一链接)` = 出码后自动跳，直接忽略（老站点「出码即跳一次」的代码升级后自动失效，按钮照常）。
 */
export const AUTO_OPEN_GUARD_MS = 1500;
const handedOut = new Map();
function markHandedOut(href) {
    if (!handedOut.has(href))
        handedOut.set(href, Date.now());
    if (handedOut.size > 50)
        handedOut.delete(handedOut.keys().next().value);
}
const TAP_EVENTS = new Set(["click", "pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "mouseup", "keydown", "keyup"]);
/** 当前是否在玩家的真实点按事件里（window.event：React / 原生 click 回调里有值）。 */
function inTap() {
    const ev = globalThis.event;
    return Boolean(ev && ev.isTrusted !== false && ev.type && TAP_EVENTS.has(ev.type));
}
/**
 * 这次 openPayLink 是不是「出码后自动跳」：链接刚由 payJump 发出、且不在点按事件里。**只拦一次**（拦下后作废），
 * 之后的调用一律放行 —— Laya 等在帧循环里派发点击（拿不到 window.event）的引擎，玩家再快点按钮也不会被吞。
 */
export function isAutoOpen(href, now = Date.now()) {
    const at = handedOut.get(href);
    if (at === undefined || now - at >= AUTO_OPEN_GUARD_MS || inTap())
        return false;
    handedOut.set(href, Number.NEGATIVE_INFINITY);
    return true;
}
/** 付款链接 `<a>` / `<iframe>` / `<img>` 必须带的属性：不把本站域名通过 Referer 泄露给通道 */
export const PAY_LINK_REL = "noreferrer noopener";
export const PAY_LINK_REFERRER_POLICY = "no-referrer";
/**
 * 打开付款链接（手机 = 本页跳转；newTab = 新标签），**不带 Referer**（业主 11-04：游戏域名不许泄露给通道）。
 * 先在 head 插 `<meta name="referrer" content="no-referrer">`（同页跳转对所有浏览器都生效），
 * 再用 `<a rel="noreferrer noopener" referrerpolicy="no-referrer">` 点击跳转；没有 click 的环境退回 location。
 * 链接本身原样用（中心给的 pay_url 或 /s/<token> 扫码页，不假设域名），绝不拼深链。
 */
export function openPayLink(href, opts = {}) {
    if (!href)
        return;
    // 6.2：出码后自动跳不做（业主 11-05：只在玩家点按钮时跳，防风控 / iOS 拦截）
    if (!opts.newTab && isAutoOpen(href))
        return;
    const g = globalThis;
    const doc = opts.doc === undefined ? g.document ?? null : opts.doc;
    const loc = opts.location === undefined ? g.location ?? null : opts.location;
    let meta = null;
    if (doc?.head) {
        meta = doc.createElement("meta");
        meta.setAttribute("name", "referrer");
        meta.setAttribute("content", PAY_LINK_REFERRER_POLICY);
        doc.head.appendChild(meta);
        // 新标签 / 跳转没走成时本页还在：过一会儿撤掉 meta，别让本站自己的请求（WAF / 防盗链看 Referer）也没了 Referer
        const m = meta;
        (opts.setTimer ?? setTimeout)(() => m.remove?.(), 1500);
    }
    const a = doc?.body ? doc.createElement("a") : null;
    if (a && doc?.body && a.click) {
        a.setAttribute("href", href);
        a.setAttribute("rel", PAY_LINK_REL);
        a.setAttribute("referrerpolicy", PAY_LINK_REFERRER_POLICY);
        if (opts.newTab)
            a.setAttribute("target", "_blank");
        doc.body.appendChild(a);
        a.click();
        a.remove?.();
        return;
    }
    if (loc)
        loc.href = href;
}
