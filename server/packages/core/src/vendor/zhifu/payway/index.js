import { withTouchHint } from "../risk/touch-hint.js";
import { isWechatOfficialLink, WX_SCREENSHOT_GUIDE } from "../presentation/index.js";
/** 默认文案。要改口径就传 tips 覆盖，别在各站各写一份。 */
export const DEFAULT_PAY_TIPS = {
    wechat: "本站目前仅支持微信支付：可扫码，或点击下方按钮跳转微信；支付宝通道暂不可用",
    alipay: "本站目前仅支持支付宝支付：可扫码，或点击下方按钮跳转支付宝；微信通道暂不可用",
    both: "微信、支付宝扫码均可支付",
};
/**
 * 从支付链接读出限定了哪种支付方式。
 * 解析不了（不是标准链接、或者根本不是 URL）一律按聚合处理 ——
 * 宁可少提示一句，也不能凭空断言某个通道不可用。
 */
export function resolvePayMethod(payUrl) {
    if (!payUrl)
        return "both";
    // ② 专属码优先：这类链接压根没有 payway 参数，但只能用对应那个 App 扫
    if (/^alipays?:\/\//i.test(payUrl) || /(^|\/\/|\.)qr\.alipay\.com\//i.test(payUrl))
        return "alipay";
    if (/^weixin:\/\//i.test(payUrl) || /(^|\/\/|\.)wx\.tenpay\.com\//i.test(payUrl))
        return "wechat";
    let payway = "";
    try {
        payway = new URL(payUrl).searchParams.get("payway") ?? "";
    }
    catch {
        // 有些站把整段查询串存下来传进来，退一步用正则找
        payway = /[?&]payway=(\d+)/.exec(payUrl)?.[1] ?? "";
    }
    if (payway === "3")
        return "wechat";
    if (payway === "1" || payway === "2")
        return "alipay";
    return "both";
}
/** 给玩家看的一句话。tips 可覆盖单条或整份。 */
export function payTipOf(method, tips) {
    return tips?.[method] ?? DEFAULT_PAY_TIPS[method];
}
/**
 * 一步到位：给支付链接，拿到该显示什么。
 *
 * `payTip` 给人看，`payMethod` 给代码看（要画微信/支付宝图标、要禁按钮时用它，
 * 别去正则匹配文案 —— 文案一改你的判断就悄悄失效）。
 */
export function describePayway(payUrl, tips) {
    const payMethod = resolvePayMethod(payUrl);
    return { payMethod, payTip: payTipOf(payMethod, tips) };
}
function isMobileUa(ua, maxTouchPoints = 0) {
    if (/iPhone|iPod|Android|Mobile|HarmonyOS/i.test(ua))
        return true;
    if (/iPad/i.test(ua))
        return true;
    if (/Macintosh/i.test(ua) && maxTouchPoints > 1)
        return true;
    return false;
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
export function buildPayEntry(opts) {
    const { payUrl, checkoutUrl, env, tips } = opts;
    const ua = env.userAgent || "";
    const method = resolvePayMethod(payUrl);
    const tip = payTipOf(method, tips);
    const isMobile = isMobileUa(ua, env.maxTouchPoints ?? 0);
    const base = { method, tip, isMobile };
    if (!payUrl)
        return { ...base, href: null, label: "", guide: null };
    // 6.11 微信付款码（wx_qr）：浏览器拉不起微信付款，任何环境都不给按钮，只扫码；手机给「截图 → 相册」引导。
    // 中心给了 linkKind 就按它；没给（老中心）只认 weixin:// 付款码（https 的微信 H5 照旧给按钮）。
    const wxQr = opts.linkKind ? opts.linkKind === "wx_qr" : /^weixin:/i.test(payUrl);
    if (wxQr && isWechatOfficialLink(payUrl)) {
        return { ...base, href: null, label: "", guide: isMobile ? WX_SCREENSHOT_GUIDE : null };
    }
    if (isMobile) {
        if (/MicroMessenger/i.test(ua) && opts.linkKind !== "wx_h5") {
            return {
                ...base,
                href: null,
                label: "",
                guide: "微信里打不开支付宝，请点右上角「···」→「在浏览器中打开」后再支付",
            };
        }
        return {
            ...base,
            // iPad（Mac UA + 触屏）跳中心 /s/ 链接时带触屏标记，中心 allowTablet 规则据此放行（zhifu/risk touch-hint）
            href: withTouchHint(payUrl, env),
            label: "跳转支付",
            guide: null,
        };
    }
    // 电脑端
    return {
        ...base,
        href: checkoutUrl || null,
        label: "跳转支付",
        guide: null,
    };
}
