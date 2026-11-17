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
/** Where the payer is. "unknown" = no UA (never guessed as desktop). */
export type PayScene = "desktop" | "mobile" | "tablet" | "unknown";
/**
 * Link kinds an upstream can hand out:
 * - `h5`        the upstream's own H5 pay page (opens Alipay from the phone browser; may auto-redirect);
 * - `alipay_qr` Alipay's OFFICIAL link (https *.alipay.com, e.g. render.alipay.com/p/s/i/?scheme=… or
 *               qr.alipay.com/…): scannable by the Alipay app (also from a screenshot in the album) AND tappable on a
 *               phone (Alipay's own landing page opens the app on the player's tap);
 * - `page`      a desktop cashier page;
 * - `wx_qr`     WeChat Pay's OFFICIAL native-pay code (`weixin://wxpay/bizpayurl?pr=…`, or https on wx.tenpay.com /
 *               payapp.weixin.qq.com / payapp.wechatpay.cn): scan-only — a browser cannot open WeChat from it, so EVERY scene shows
 *               the QR, never a jump button (6.11, owner 11-10);
 * - `wx_h5`     the upstream's https phone page for WeChat (shows the QR + 「长按保存 → 扫一扫 → 相册」 steps; WeChat
 *               cannot be opened from a browser): phone = tap-to-open button + WeChat hint, no small QR (6.12).
 */
export type PayLinkKind = "h5" | "alipay_qr" | "page" | "wx_qr" | "wx_h5";
export declare const PAY_LINK_KINDS: readonly PayLinkKind[];
/** 二维码模式: "all" = every scene gets the official QR link when the channel has one; "desktop" = desktop only. */
export type QrMode = "all" | "desktop" | "off";
export declare const QR_MODES: readonly QrMode[];
/** Default when neither site nor channel sets it (owner 11-05: one link that is QR, screenshot-QR and jump). */
export declare const DEFAULT_QR_MODE: QrMode;
/** Owner 11-05 wording; the line under the phone jump button (editable per channel / site: `jumpHint`). */
export declare const DEFAULT_JUMP_HINT = "\u8DF3\u8F6C\u4E0D\u4E86\uFF1F\u53EF\u4EE5\u622A\u56FE\u4FDD\u5B58\u4E8C\u7EF4\u7801\uFF0C\u5728\u652F\u4ED8\u5B9D\u91CC\u4ECE\u76F8\u518C\u626B\u7801\u4ED8\u6B3E";
export declare const JUMP_HINT_MAX = 120;
/** 6.11 owner 11-10 wording: what a phone player does with a WeChat Pay QR (no jump exists for WeChat). */
/**
 * 6.13.1 owner 11-10 19:00: WeChat refuses album recognition of a pay code, so the phone copy asks for a CAMERA scan
 * from another device (no album instructions).
 */
export declare const WX_SCREENSHOT_GUIDE = "\u5FAE\u4FE1\u4E0D\u652F\u6301\u8BC6\u522B\u672C\u673A\u76F8\u518C\u91CC\u7684\u4ED8\u6B3E\u7801\u3002\u8BF7\u957F\u6309\u4FDD\u5B58\u6216\u622A\u56FE\uFF0C\u53D1\u5230\u53E6\u4E00\u53F0\u624B\u673A\u6216\u7535\u8111\u4E0A\u6253\u5F00\uFF0C\u518D\u7528\u672C\u673A\u5FAE\u4FE1\u300C\u626B\u4E00\u626B\u300D\u626B\u5C4F\u5E55\u4ED8\u6B3E\uFF1B\u4E5F\u53EF\u4EE5\u76F4\u63A5\u8BA9\u670B\u53CB\u7528\u5FAE\u4FE1\u626B\u8FD9\u4E2A\u7801";
export declare const WX_OTHER_DEVICE_TITLE = "\u8BF7\u7528\u53E6\u4E00\u53F0\u624B\u673A\u7684\u5FAE\u4FE1\u626B\u7801\u4ED8\u6B3E";
/** 6.12 owner 11-10: the line under the phone button that opens the upstream WeChat page (`wx_h5`). */
export declare const WX_JUMP_HINT = "\u6253\u5F00\u540E\u957F\u6309\u4E8C\u7EF4\u7801\u4FDD\u5B58\uFF0C\u518D\u7528\u5FAE\u4FE1\u626B\u4E00\u626B \u2192 \u76F8\u518C";
/** Per-channel (rule) or per-site (site config) override; missing fields fall through. */
export interface PresentationRule {
    qrMode?: QrMode | undefined;
    /** 1–120 chars; shown under the phone jump button. */
    jumpHint?: string | undefined;
}
export interface Presentation {
    qrMode: QrMode;
    jumpHint: string;
}
/** site > channel > defaults. Pure. */
export declare function resolvePresentation(site: PresentationRule | null | undefined, channel: PresentationRule | null | undefined): Presentation;
export interface SceneHints {
    userAgent: string | null | undefined;
    /** Client hint from the site page: `navigator.maxTouchPoints` (iPadOS Safari reports a Mac UA). */
    maxTouchPoints?: number | null | undefined;
    /** Same fact as a flag (the center `zt=1` touch hint). */
    touchHint?: boolean | null | undefined;
}
/**
 * The payer's scene from the UA + client hints. In-app browsers (Alipay / WeChat …) and phones = mobile; an iPad
 * UA, or a Mac UA with touch, = tablet; any other UA = desktop; no UA = unknown. Pure.
 */
export declare function detectPayScene(h: SceneHints): PayScene;
/**
 * Which link kind to ask the adapter for; null = its default. The official QR link goes to every scene under
 * "all", to desktop only under "desktop", never under "off" or when the adapter has none. Pure.
 */
export declare function wantLink(scene: PayScene, links: readonly PayLinkKind[] | undefined, qrMode: QrMode): PayLinkKind | null;
/** https on alipay.com or one of its subdomains — the only links accepted as `alipay_qr`. Pure. */
export declare function isAlipayOfficialLink(url: string | null | undefined): boolean;
/**
 * WeChat Pay's official native-pay link — the only links accepted as `wx_qr`: `weixin://wxpay/bizpayurl?…`, or
 * https on wx.tenpay.com / payapp.weixin.qq.com / payapp.wechatpay.cn (exact hosts, default port). Any nested URL in
 * the path, query or fragment is refused, so a link can never carry another site (ours included) to WeChat. Pure.
 */
export declare function isWechatOfficialLink(url: string | null | undefined): boolean;
/**
 * An upstream https pay page we may hand to the player (`wx_h5`): https, default port, no credentials and no nested
 * URL anywhere after the host — so it can never carry another site (ours included). Pure.
 */
export declare function isUpstreamPayPage(url: string | null | undefined): boolean;
/** Kind of a stored link: the adapter's word when given, else official Alipay → alipay_qr, WeChat → wx_qr, else h5. Pure. */
export declare function linkKindOf(url: string | null | undefined, declared?: string | null): PayLinkKind | null;
/**
 * Contract check of one create result against the adapter's declaration (framework-free; [] = OK): links are
 * declared; the returned kind is declared; an `alipay_qr` link is an official Alipay https link; a wanted kind the
 * adapter declares was honoured.
 */
export declare function presentationProblems(adapter: {
    links?: readonly PayLinkKind[] | undefined;
}, wanted: PayLinkKind | null, result: {
    ok: boolean;
    payUrl?: string | undefined;
    linkKind?: PayLinkKind | undefined;
}): string[];
/**
 * The single QR image of an upstream WeChat pay page (`wx_h5`), as an absolute URL on the page's OWN host; null when
 * the page is not a clean upstream page or has zero / several such images (never guess). Pure.
 */
export declare function upstreamQrImageUrl(html: string, pageUrl: string): string | null;
/** Max PNG bytes accepted for the overlay QR image. */
export declare const QR_IMAGE_MAX_BYTES = 100000;
/** PNG signature + size cap → `data:image/png;base64,…`; null otherwise. Pure. */
export declare function pngDataUrl(bytes: Uint8Array, contentType: string | null): string | null;