/**
 * 扫码建单闸门的判定部分（纯函数）：认客户端、认地区、判扫码过快。限流计数 / IP 信誉查询是 I/O，留给消费方。
 */
export type ScanClientKind = "alipay" | "phone" | "tablet" | "other";
/** 支付宝 App 内置浏览器（iOS / Android 都带 `AlipayClient/<ver>`）。 */
export declare function isAlipayClient(userAgent: string | null): boolean;
/** 手机自带浏览器（站点「手机跳转」），不是电脑，也不是微信 / QQ 等内置扫码。 */
export declare function isPhoneBrowser(userAgent: string | null): boolean;
/**
 * iPadOS 13+ Safari 默认上报 Mac 桌面 UA，服务端分不出来；站点包在 `navigator.maxTouchPoints > 1` 时给跳转链接
 * 加触屏标记（`touch-hint.ts`）。只有「带标记 + Mac UA（或 iPad UA）+ 非内置浏览器」才算平板。
 */
export declare function isTabletClient(userAgent: string | null, touchHint: boolean): boolean;
export declare function classifyScanClient(userAgent: string | null, touchHint: boolean): ScanClientKind;
export interface ScanClientRules {
    /** 规则 scanClient 的开关：关 = 谁扫都行 */
    alipayOnly: boolean;
    allowPhoneBrowser: boolean;
    /** 规则 allowTablet */
    allowTablet: boolean;
}
/** 这个客户端能不能建上游单。手机 / 平板都是「本机跳转」，平板受 allowTablet 单独控制。 */
export declare function scanClientAllowed(kind: ScanClientKind, r: ScanClientRules): boolean;
/** 本机跳转（手机 / 平板）太早到达不拒，等满最快扫码时间再建单；支付宝扫码太早 = 脚本。 */
export declare function isLocalJump(kind: ScanClientKind, r: ScanClientRules): boolean;
export type IpRegion = "中国大陆" | "港澳台" | "境外" | "未知";
/** 离线库一行的地区（ip2region：港澳台按 国家=中国 + 省=香港/澳门/台湾 返回）。 */
export declare function regionOf(geo: {
    country: string;
    province: string;
} | null | undefined): IpRegion;
export interface RegionRules {
    blockOverseas: boolean;
    blockHkMoTw: boolean;
    blockUnknownGeo: boolean;
}
/** 三个开关各管各的（境外 / 港澳台 / 未知），互不牵连。 */
export declare function regionBlocked(region: IpRegion, r: RegionRules): boolean;
/** 距离最快扫码时间还差多少毫秒（≤ 0 = 不算早）。 */
export declare function scanEarlyMs(issuedAt: Date, now: Date, minScanDelayMs: number): number;