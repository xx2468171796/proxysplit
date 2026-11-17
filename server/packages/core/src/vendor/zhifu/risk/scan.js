/**
 * 扫码建单闸门的判定部分（纯函数）：认客户端、认地区、判扫码过快。限流计数 / IP 信誉查询是 I/O，留给消费方。
 */
const IN_APP = /micromessenger|\bqq\/|weibo|dingtalk|aweme|newsarticle|baiduboxapp|xhsdiscover/i;
/** 支付宝 App 内置浏览器（iOS / Android 都带 `AlipayClient/<ver>`）。 */
export function isAlipayClient(userAgent) {
    return /alipayclient/i.test(userAgent ?? "");
}
/** 手机自带浏览器（站点「手机跳转」），不是电脑，也不是微信 / QQ 等内置扫码。 */
export function isPhoneBrowser(userAgent) {
    const ua = userAgent ?? "";
    if (IN_APP.test(ua))
        return false;
    return /iphone|ipod|android|harmonyos|openharmony/i.test(ua);
}
/**
 * iPadOS 13+ Safari 默认上报 Mac 桌面 UA，服务端分不出来；站点包在 `navigator.maxTouchPoints > 1` 时给跳转链接
 * 加触屏标记（`touch-hint.ts`）。只有「带标记 + Mac UA（或 iPad UA）+ 非内置浏览器」才算平板。
 */
export function isTabletClient(userAgent, touchHint) {
    const ua = userAgent ?? "";
    if (IN_APP.test(ua))
        return false;
    if (/ipad/i.test(ua))
        return true;
    return touchHint && /macintosh/i.test(ua);
}
export function classifyScanClient(userAgent, touchHint) {
    if (isAlipayClient(userAgent))
        return "alipay";
    if (isPhoneBrowser(userAgent))
        return "phone";
    if (isTabletClient(userAgent, touchHint))
        return "tablet";
    return "other";
}
/** 这个客户端能不能建上游单。手机 / 平板都是「本机跳转」，平板受 allowTablet 单独控制。 */
export function scanClientAllowed(kind, r) {
    if (!r.alipayOnly || kind === "alipay")
        return true;
    if (kind === "phone")
        return r.allowPhoneBrowser;
    if (kind === "tablet")
        return r.allowPhoneBrowser && r.allowTablet;
    return false;
}
/** 本机跳转（手机 / 平板）太早到达不拒，等满最快扫码时间再建单；支付宝扫码太早 = 脚本。 */
export function isLocalJump(kind, r) {
    if (kind === "phone")
        return r.allowPhoneBrowser;
    if (kind === "tablet")
        return r.allowPhoneBrowser && r.allowTablet;
    return false;
}
const HK_MO_TW = /^(香港|澳门|台湾)/;
/** 离线库一行的地区（ip2region：港澳台按 国家=中国 + 省=香港/澳门/台湾 返回）。 */
export function regionOf(geo) {
    if (!geo?.country || geo.country === "0" || geo.country === "内网IP")
        return "未知";
    if (geo.country !== "中国")
        return "境外";
    return HK_MO_TW.test(geo.province) ? "港澳台" : "中国大陆";
}
/** 三个开关各管各的（境外 / 港澳台 / 未知），互不牵连。 */
export function regionBlocked(region, r) {
    if (region === "境外")
        return r.blockOverseas;
    if (region === "港澳台")
        return r.blockHkMoTw;
    return region === "未知" && r.blockUnknownGeo;
}
/** 距离最快扫码时间还差多少毫秒（≤ 0 = 不算早）。 */
export function scanEarlyMs(issuedAt, now, minScanDelayMs) {
    return minScanDelayMs - (now.getTime() - issuedAt.getTime());
}
