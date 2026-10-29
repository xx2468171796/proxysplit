/**
 * zhanghao/yanzheng —— 把 yanzheng(人机验证 / 短信码 / 邮箱码 / 登录防护 / 单设备)一行摆进本包。
 *
 *   const bits = withYanzheng(yz);                       // yz = yanzheng 的 setup() 门面
 *   const zh = createZhanghao({ ..., loginGuard: bits.loginGuard, singleSession: bits.singleSession });
 *   const handlers = createZhanghaoHttpHandlers(zh, { verify: bits.verify });
 *
 * **本文件不 import yanzheng 的任何运行时代码**(包继续零运行时依赖):下面的 `CaptchaLike` /
 * `CodeServiceLike` 是**结构类型**,与 yanzheng v1.66 的 `CaptchaVerifier`(`captcha/verify.ts`)、
 * `SmsCodeService` / `EmailCodeService`(`shared/code-service.ts` 的 `verifyCode`)逐字同形;
 * `test/yanzheng-compat.test.ts` 用 yanzheng 的真类型做可赋值断言钉住 —— 上游改签名这里当场红。
 *
 * 边界:本包**不发码、不出题**。发短信/邮箱码、滑块出题与校验路由仍走 yanzheng 自己的
 * (`yz.captchaRoutes` / `yz.sms.sendCode` / `yz.email.sendCode`);本包只在 register / login /
 * resetPassword / bindPhone / bindEmail 之前**消费**票和码。
 */
import { ZhanghaoError } from "./types.js";
const DEFAULT_CAPTCHA = { register: "slider", login: "slider", resetPassword: "none" };
const DEFAULT_MESSAGES = {
    captcha: "请先完成人机验证",
    code: "验证码错误或已过期",
    channelUnavailable: "该验证渠道当前未开启",
};
function str(v) {
    return typeof v === "string" && v !== "" ? v : undefined;
}
/* ────────────────────────────── 工厂 ────────────────────────────── */
export function withYanzheng(yz, opts = {}) {
    const modes = { ...DEFAULT_CAPTCHA, ...(opts.captcha ?? {}) };
    const actionOf = opts.captchaAction ?? ((route) => route);
    const captchaField = opts.captchaField ?? "captchaToken";
    const powField = opts.powField ?? "captchaTokenPow";
    const codeField = opts.codeField ?? "code";
    const msg = { ...DEFAULT_MESSAGES, ...(opts.messages ?? {}) };
    function isCaptchaRoute(route) {
        return route === "register" || route === "login" || route === "resetPassword";
    }
    async function captcha(ctx) {
        if (!isCaptchaRoute(ctx.route))
            return;
        const mode = modes[ctx.route];
        if (mode === "none")
            return;
        // 配了要验、却没有验证器 → 拒绝。放行等于「后台一关 captcha 组件,注册口就裸奔」且没人知道
        if (!yz.captcha)
            throw new ZhanghaoError("VERIFICATION_FAILED", msg.captcha, { route: ctx.route, reason: "captcha_unavailable" });
        const ok = mode === "slider"
            ? await yz.captcha.consumeSlider(str(ctx.verification[captchaField]), { action: actionOf(ctx.route) })
            : await yz.captcha.verifyPow(str(ctx.verification[powField]));
        if (!ok)
            throw new ZhanghaoError("VERIFICATION_FAILED", msg.captcha, { route: ctx.route, reason: mode === "slider" ? "captcha_slider" : "captcha_pow" });
    }
    async function code(ctx) {
        const svc = ctx.channel === "phone" ? yz.sms : yz.email;
        // 渠道没配 → 拒绝而不是放行:否则「短信服务还没接」的站上,任何人填任意手机号都能注册/找回
        if (!svc)
            throw new ZhanghaoError("VERIFICATION_FAILED", msg.channelUnavailable, { route: ctx.route, channel: ctx.channel, reason: "channel_unavailable" });
        const input = str(ctx.verification[codeField]);
        if (!input)
            throw new ZhanghaoError("VERIFICATION_FAILED", msg.code, { route: ctx.route, channel: ctx.channel, reason: "code_missing", field: codeField });
        const r = await svc.verifyCode(ctx.target, ctx.purpose, input);
        if (!r.ok)
            throw new ZhanghaoError("VERIFICATION_FAILED", r.message || msg.code, { route: ctx.route, channel: ctx.channel, reason: "code_rejected" });
    }
    /* 只读校验(yanzheng ≥ 2.4.0 的 `verifyCode(..., { consume: false })`)。
       ⚠ 只在两个渠道都**确实支持**时才提供 —— 旧版 yanzheng 会忽略第 4 个参数、照样消费,
       于是后面那次真正消费会因为码已被删判「已过期」,比不做两段式更糟。
       判据用函数的形参个数(旧版 3 个、新版 4 个):能力探测做不了(探一次就会消费掉码)。 */
    const peekable = (svc) => !svc || svc.verifyCode.length >= 4;
    async function peekCode(ctx) {
        const svc = ctx.channel === "phone" ? yz.sms : yz.email;
        if (!svc)
            throw new ZhanghaoError("VERIFICATION_FAILED", msg.channelUnavailable, { route: ctx.route, channel: ctx.channel, reason: "channel_unavailable" });
        const input = str(ctx.verification[codeField]);
        if (!input)
            throw new ZhanghaoError("VERIFICATION_FAILED", msg.code, { route: ctx.route, channel: ctx.channel, reason: "code_missing", field: codeField });
        const r = await svc.verifyCode(ctx.target, ctx.purpose, input, { consume: false });
        if (!r.ok)
            throw new ZhanghaoError("VERIFICATION_FAILED", r.message || msg.code, { route: ctx.route, channel: ctx.channel, reason: "code_rejected" });
    }
    const bits = {
        verify: { captcha, code, ...(peekable(yz.sms) && peekable(yz.email) && (yz.sms || yz.email) ? { peekCode } : {}) },
    };
    if (yz.loginGuard)
        bits.loginGuard = yz.loginGuard;
    if (yz.singleSession)
        bits.singleSession = yz.singleSession;
    return bits;
}
