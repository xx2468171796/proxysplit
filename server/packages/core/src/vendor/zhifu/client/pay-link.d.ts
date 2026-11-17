export interface PayJump {
    /** 按钮要跳的地址；null = 这个环境不给按钮（微信里 / 电脑拿不到收银台） */
    href: string | null;
    label: string;
    /** 跳不了时要显示的引导（微信内置浏览器）；null = 无 */
    guide: string | null;
    /** 按钮下方常驻的「跳不过去就截图扫码」；没有按钮时为 null */
    fallback: string | null;
    isMobile: boolean;
}
/**
 * 跳转按钮：规则同 buildPayEntry（5ff / 5e 线上验证过），文案统一成 PAY_COPY。
 * 6.2（业主 11-05，付款展示标准 zhifu/presentation）：手机 = 玩家**点按钮**才跳（出码后不自动跳；`openPayLink`
 * 对刚发出的链接的自动调用直接忽略），按钮下方常驻 `hint`（中心下发的 `jumpHint`，站点 > 通道 > 默认），二维码照常显示
 * 给「截图到相册再扫」兜底；电脑 = 只显示二维码。
 */
export declare function payJump(opts: {
    payUrl: string | null | undefined;
    checkoutUrl?: string | null;
    userAgent: string;
    maxTouchPoints?: number;
    /** 中心下发的跳转提示（SiteOrder.jumpHint）；空 = 默认文案 */
    hint?: string | null;
    /** 中心的 link_kind（SiteOrder.linkKind）："wx_qr" = 微信付款码，不给按钮（6.11）；"wx_h5" = 微信手机付款页，按钮 + 微信提示（6.12） */
    linkKind?: string | null;
}): PayJump;
/**
 * 自动跳转护栏（6.2）：payJump 刚给出手机跳转链接后 AUTO_OPEN_GUARD_MS 内、又不在玩家真实点击事件里的
 * `openPayLink(同一链接)` = 出码后自动跳，直接忽略（老站点「出码即跳一次」的代码升级后自动失效，按钮照常）。
 */
export declare const AUTO_OPEN_GUARD_MS = 1500;
/**
 * 这次 openPayLink 是不是「出码后自动跳」：链接刚由 payJump 发出、且不在点按事件里。**只拦一次**（拦下后作废），
 * 之后的调用一律放行 —— Laya 等在帧循环里派发点击（拿不到 window.event）的引擎，玩家再快点按钮也不会被吞。
 */
export declare function isAutoOpen(href: string, now?: number): boolean;
/** 页面里打开付款链接要用到的最小 DOM 面（测试可注入假的） */
export interface PayLinkDoc {
    head?: {
        appendChild(n: unknown): unknown;
    } | null;
    body?: {
        appendChild(n: unknown): unknown;
    } | null;
    createElement(tag: string): PayLinkEl;
}
interface PayLinkEl {
    setAttribute(k: string, v: string): void;
    click?: () => void;
    remove?: () => void;
}
/** 付款链接 `<a>` / `<iframe>` / `<img>` 必须带的属性：不把本站域名通过 Referer 泄露给通道 */
export declare const PAY_LINK_REL = "noreferrer noopener";
export declare const PAY_LINK_REFERRER_POLICY = "no-referrer";
/**
 * 打开付款链接（手机 = 本页跳转；newTab = 新标签），**不带 Referer**（业主 11-04：游戏域名不许泄露给通道）。
 * 先在 head 插 `<meta name="referrer" content="no-referrer">`（同页跳转对所有浏览器都生效），
 * 再用 `<a rel="noreferrer noopener" referrerpolicy="no-referrer">` 点击跳转；没有 click 的环境退回 location。
 * 链接本身原样用（中心给的 pay_url 或 /s/<token> 扫码页，不假设域名），绝不拼深链。
 */
export declare function openPayLink(href: string, opts?: {
    newTab?: boolean;
    doc?: PayLinkDoc | null;
    location?: {
        href: string;
    } | null;
    setTimer?: (fn: () => void, ms: number) => unknown;
}): void;
export {};