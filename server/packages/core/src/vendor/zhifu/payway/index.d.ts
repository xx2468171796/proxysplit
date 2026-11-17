/**
 * 支付方式提示 —— 告诉玩家这笔该用微信还是支付宝扫。
 *
 * 为什么需要它：聚合通道的微信/支付宝是**分别授权**的，任何一边都可能被单独关掉
 * （2026-09-11 收钱吧就对一个终端返回过 EP297「当前支付方式收款权限被关闭」，
 * 支付宝连续 26 笔全失败、微信照常）。这时候二维码还在、扫也能扫，只是扫完必然失败 ——
 * 玩家看不到任何解释，只会以为「你们的充值坏了」。
 *
 * 判断依据有两条，都只看**支付链接本身**：
 *   ① 链接里实际带的 `payway`（收钱吧官方口径：微信 `3`，支付宝常见 `1`/`2`，不带 = 聚合）；
 *   ② 链接本身就是某一家的专属码 —— 比如支付宝直连收款给出的 `https://qr.alipay.com/xxx`，
 *      那种码微信扫了只会报「无法识别」。这类链接没有 `payway` 参数，光看 ① 会误判成聚合，
 *      于是提示写着「微信也行」、玩家拿微信一扫就失败（2026-09-12 网关切支付宝直连时遇到）。
 * 绝不能让文案和真实开放的通道分头维护 ——
 * 「提示说能用支付宝、扫了却失败」比没有提示更伤人。通道那边一改配置，这里的结论自己就跟着变。
 *
 * 用法（用 zhifu 下单的站什么都不用做，`createOrder` 的结果里已经带上了）：
 *
 *     import { resolvePayMethod, payTipOf } from "zhifu/payway";
 *     const tip = payTipOf(resolvePayMethod(payUrl));   // "请使用微信扫码支付；支付宝通道暂时不可用"
 */
/** both = 微信支付宝都能扫（聚合） */
export type PayMethod = "wechat" | "alipay" | "both";
/** 默认文案。要改口径就传 tips 覆盖，别在各站各写一份。 */
export declare const DEFAULT_PAY_TIPS: Record<PayMethod, string>;
/**
 * 从支付链接读出限定了哪种支付方式。
 * 解析不了（不是标准链接、或者根本不是 URL）一律按聚合处理 ——
 * 宁可少提示一句，也不能凭空断言某个通道不可用。
 */
export declare function resolvePayMethod(payUrl: string | null | undefined): PayMethod;
/** 给玩家看的一句话。tips 可覆盖单条或整份。 */
export declare function payTipOf(method: PayMethod, tips?: Partial<Record<PayMethod, string>>): string;
/**
 * 一步到位：给支付链接，拿到该显示什么。
 *
 * `payTip` 给人看，`payMethod` 给代码看（要画微信/支付宝图标、要禁按钮时用它，
 * 别去正则匹配文案 —— 文案一改你的判断就悄悄失效）。
 */
export declare function describePayway(payUrl: string | null | undefined, tips?: Partial<Record<PayMethod, string>>): {
    payMethod: PayMethod;
    payTip: string;
};
/** 判断浏览器环境用的最小输入。传进来而不是直接读 navigator —— 服务端渲染也要能算。 */
export interface PayEnv {
    userAgent: string;
    /** iPadOS 13+ 的 Safari 默认按 Macintosh 上报，只能靠触点数区分 */
    maxTouchPoints?: number;
}
export interface PayEntry {
    /** 机器可读的支付方式 */
    method: PayMethod;
    /** 给玩家看的一句话 */
    tip: string;
    /** 是否手机环境 */
    isMobile: boolean;
    /** 跳转按钮该跳的地址；null = 这个环境下不该给按钮 */
    href: string | null;
    /** 按钮文案；href 为 null 时无意义 */
    label: string;
    /** 跳不了时要显示的引导（微信内置浏览器）；null = 无 */
    guide: string | null;
}
/**
 * 算出这笔该给玩家什么付款入口 —— 各站别再各写一份 UA 判断。
 *
 * 三种环境给三种东西，都是线上踩出来的：
 *
 *  - **手机 · 微信内置浏览器**：微信里拉不起支付宝，只能给引导文案，按钮给了也是白给。
 *  - **手机 · 其它浏览器（含支付宝内置浏览器）**：直接打开 `payUrl` 本身（通道自己的付款页，
 *    由它去拉起支付）。**禁止**再拼 `alipays://` / `intent://` 深链（业主 2026-11-04：付款一律落到
 *    通道自己的页面）。电脑端二维码的内容同样必须是 `payUrl` 本身。
 *  - **电脑**：必须跳 `checkoutUrl`（收银台页），**不能跳 payUrl** —— 支付宝的
 *    `qr.alipay.com` 短链在电脑上会落到 `ds.alipay.com`「请用手机打开」引导页，付不了款。
 *    拿不到 checkoutUrl 就不给按钮，让玩家扫码；给个点了没用的按钮比不给更糟。
 */
export declare function buildPayEntry(opts: {
    payUrl?: string | null;
    /** 收银台页地址（电脑端跳它）。网关 create 响应里的 checkout_url */
    checkoutUrl?: string | null;
    env: PayEnv;
    tips?: Partial<Record<PayMethod, string>>;
    /** 6.11 中心的 link_kind（SiteOrder.linkKind）；"wx_qr" = 微信付款码，只扫码不给按钮 */
    linkKind?: string | null;
}): PayEntry;