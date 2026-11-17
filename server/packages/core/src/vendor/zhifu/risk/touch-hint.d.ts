/**
 * iPad 触屏标记（业主 11-04）：iPadOS Safari 上报 Mac 桌面 UA，支付中心 `/s/` 闸门会当电脑拒掉。
 * 站点包在 `maxTouchPoints > 1` 的 Mac UA 下给中心扫码链接加 `zt=1`。标记**可以被伪造**（和 UA 一样是客户端说了算）：
 * allowTablet 开着时，带标记的 Mac UA 按平板过客户端这一关（和手机跳转同等待遇，等满最快扫码时间再建单），
 * 风险与伪造 iPhone UA 相同；IP 信誉 / 频率照查。只改中心 `/s/<token>` 链接，不碰上游付款页。
 */
export declare const TOUCH_HINT_PARAM = "zt";
export declare function isCenterScanLink(url: string): boolean;
export declare function needsTouchHint(env: {
    userAgent: string;
    maxTouchPoints?: number | undefined;
}): boolean;
export declare function withTouchHint(url: string, env: {
    userAgent: string;
    maxTouchPoints?: number | undefined;
}): string;
export declare function hasTouchHint(query: Readonly<Record<string, string | undefined>>): boolean;