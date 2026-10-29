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
import type { LoginGuard, SingleSession } from "./ports.ts";
import type { VerificationHooks, VerifyRoute } from "./http/handlers.ts";
/** = yanzheng `CaptchaVerifier`(createCaptchaVerifier 的返回值) */
export interface CaptchaLike {
    /** 一次性消费滑块票;false = 没有 / 用过 / 过期 / action·context 绑定对不上 */
    consumeSlider(token: string | undefined | null, expect?: {
        session?: string;
        action?: string;
        context?: string;
        ip?: string;
    }): Promise<boolean>;
    /** 一次性校验 PoW 解 */
    verifyPow(payload: string | undefined | null): Promise<boolean>;
}
/** = yanzheng `SmsCodeService` / `EmailCodeService` 的 `verifyCode`(成功即消费,一次性) */
export interface CodeServiceLike {
    verifyCode(rawTarget: string, purpose: "register" | "reset" | "bind", input: string, opts?: {
        consume?: boolean;
    }): Promise<{
        ok: boolean;
        message: string;
    }>;
}
/** yanzheng setup() 门面里本包会用到的那几块;都是可选的,没配就不接 */
export interface YanzhengLike {
    captcha?: CaptchaLike;
    sms?: CodeServiceLike;
    email?: CodeServiceLike;
    loginGuard?: LoginGuard;
    singleSession?: SingleSession;
}
export type CaptchaRoute = Extract<VerifyRoute, "register" | "login" | "resetPassword">;
export type CaptchaMode = "slider" | "pow" | "none";
export interface WithYanzhengOptions {
    /**
     * 每条路由用哪种人机验证。默认 `register: slider, login: slider, resetPassword: none`
     * (找回密码那一步已经要短信/邮箱码,再叠一层滑块通常是打扰;发码那一步的滑块在 yanzheng 侧)。
     * 配了 `slider`/`pow` 而 `yz.captcha` 不存在 → **fail closed**(拒绝,不是放行)。
     */
    captcha?: Partial<Record<CaptchaRoute, CaptchaMode>>;
    /**
     * 滑块票绑定的 action 名(yanzheng 的票绑用途:签发时前端声明的 action 必须与这里一致)。
     * 默认与路由同名(`"register"` / `"login"` / `"resetPassword"`);宿主按自己的 captchaActions 覆盖。
     * **两边各写一个字面量差一个字符就是「看着验过了却过不去」,且不报错** —— 建议前后端从同一个常量取。
     */
    captchaAction?: (route: CaptchaRoute) => string;
    /** 滑块票在验证载荷里的字段名,默认 `captchaToken`(与 yanzheng 文档示例一致) */
    captchaField?: string;
    /** PoW 解在验证载荷里的字段名,默认 `captchaTokenPow` */
    powField?: string;
    /** 一次性验证码字段名,默认 `code` */
    codeField?: string;
    /** 报错文案(玩家可见) */
    messages?: {
        captcha?: string;
        code?: string;
        channelUnavailable?: string;
    };
}
export interface YanzhengBits {
    loginGuard?: LoginGuard;
    singleSession?: SingleSession;
    verify: VerificationHooks;
}
export declare function withYanzheng(yz: YanzhengLike, opts?: WithYanzhengOptions): YanzhengBits;