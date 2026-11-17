/**
 * iPad 触屏标记（业主 11-04）：iPadOS Safari 上报 Mac 桌面 UA，支付中心 `/s/` 闸门会当电脑拒掉。
 * 站点包在 `maxTouchPoints > 1` 的 Mac UA 下给中心扫码链接加 `zt=1`。标记**可以被伪造**（和 UA 一样是客户端说了算）：
 * allowTablet 开着时，带标记的 Mac UA 按平板过客户端这一关（和手机跳转同等待遇，等满最快扫码时间再建单），
 * 风险与伪造 iPhone UA 相同；IP 信誉 / 频率照查。只改中心 `/s/<token>` 链接，不碰上游付款页。
 */
export const TOUCH_HINT_PARAM = "zt";
const SCAN_PATH = /\/s\/[A-Za-z0-9._~-]+\/?$/;
export function isCenterScanLink(url) {
    try {
        return SCAN_PATH.test(new URL(url).pathname);
    }
    catch {
        return false;
    }
}
export function needsTouchHint(env) {
    return /macintosh/i.test(env.userAgent) && (env.maxTouchPoints ?? 0) > 1;
}
export function withTouchHint(url, env) {
    if (!needsTouchHint(env) || !isCenterScanLink(url))
        return url;
    const u = new URL(url);
    u.searchParams.set(TOUCH_HINT_PARAM, "1");
    return u.toString();
}
export function hasTouchHint(query) {
    return query[TOUCH_HINT_PARAM] === "1";
}
