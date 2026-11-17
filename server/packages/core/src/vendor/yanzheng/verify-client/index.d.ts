/**
 * `yanzheng/verify-client` —— 站点接雷池验证服务 leichiwaf-verify 的**唯一**实现。
 *
 * 验证码出题判卷、短信 / 邮件验证码的生成发送核对、限额、通道凭据,全部在雷池;站点只调这里的四个方法:
 *
 * ```ts
 * import { createSecurityClient, decide } from "yanzheng/verify-client";
 * const lcv = createSecurityClient({ siteId: "gx", secret: process.env.LCV_SITE_SECRET!, host: "gx.zygskins.cn" });
 * const r = await lcv.captcha.verify({ token, action: "pay", remoteIp });
 * if ((await lcv.decide("pay", r, (b) => b.success)) !== "allow") throw …;
 * ```
 *
 * 合同见 leichiwaf `docs/verify-INTEGRATION.md`;本包 INTEGRATION.md §3.20。
 * 传输只走 node:http 并显式带 Host(Node fetch 会丢 Host,见 transport.ts)。
 */
import { type CallResult, DEFAULT_FAIL_CLOSED, type Decision, decide, failMode, type Scene } from "./fail-mode.ts";
import { type GateOutcome } from "./gate-policy.ts";
import { type TicketPayload } from "./jwks.ts";
export type { CallResult, Decision, Scene } from "./fail-mode.ts";
export type { TicketPayload } from "./jwks.ts";
export { canonicalRequest, signRequest, subjectHash } from "./sign.ts";
export { DEFAULT_FAIL_CLOSED, decide, failMode };
export { IPREP_DEFAULT_TIMEOUT_MS, parseIprepResult } from "./iprep.ts";
export type { Iprep, IprepCallOptions, IprepCheckInput, IprepFlags, IprepLevel, IprepManual, IprepOutcomeInput, IprepOutcomeKind, IprepReason, IprepRegion, IprepResult, IprepVerdict } from "./iprep.ts";
export declare const DEFAULT_VERIFY_URL = "http://127.0.0.1:8977";
export interface SecurityClientOptions {
    siteId: string;
    /** 雷池给本站发的 secret(≥ 32 字符),只从环境变量 / 密钥文件读 */
    secret: string;
    /** 本站对外域名,凭证绑定它,如 "gx.zygskins.cn" */
    host: string;
    /** 默认 sz 本机 http://127.0.0.1:8977 */
    baseUrl?: string;
    /** 单次请求超时,默认 2000 */
    timeoutMs?: number;
    /** 测试缝:时钟(毫秒) */
    now?: () => number;
    /** 告警出口(与 createSiteOtp 的 log 同形,可传同一个);不传走 console。目前只报「中心下发的 failClosed 不可用 / 有不认识的场景」 */
    log?: (level: "warn" | "error", msg: string, meta?: unknown) => void;
}
export type OtpPurpose = "register" | "login" | "reset" | "bind" | "pay";
export interface CaptchaVerifyInput {
    token: string;
    action: string;
    remoteIp?: string;
    deviceFp?: string;
}
export interface CaptchaVerifyBody {
    success: boolean;
    action?: string;
    hostname?: string;
    risk?: number | null;
    errorCodes?: string[];
    resultToken?: string;
}
/**
 * clientIp 必填(玩家真实 IP,服务端按它做 IP 维度限额)。人机凭证三选一:
 * - captchaTicket:页面 LcVerify.open({action:"sms"}) 的票
 * - captchaVerification:AJ 适配通行(GX / F7 原版客户端过了滑块后自算的那串,用途必须是 account)
 * - captchaExempt: true:只对雷池站点配置 captchaExempt 列出的用途有效;**只能由站点服务端在确定的流程里写死,绝不透传玩家字段**
 */
export type OtpSendInput = {
    purpose: OtpPurpose;
    channel: "sms" | "email";
    to: string;
    clientIp: string;
    deviceFp?: string;
} & ({
    captchaTicket: string;
    captchaVerification?: never;
    captchaExempt?: never;
} | {
    captchaVerification: string;
    captchaTicket?: never;
    captchaExempt?: never;
} | {
    captchaExempt: true;
    captchaTicket?: never;
    captchaVerification?: never;
});
export interface OtpSendBody {
    ok: true;
    verificationId: string;
    expiresIn: number;
    resendAfter: number;
}
/** subject 必填 = 发码时的手机号 / 邮箱;号不对也消耗一次尝试 */
export interface OtpCheckInput {
    verificationId: string;
    code: string;
    purpose: OtpPurpose;
    subject: string;
}
export interface OtpCheckBody {
    ok: boolean;
    attemptsLeft: number;
    resultToken?: string;
    error?: string;
}
/** AJ-Captcha 兼容适配(leichiwaf docs/verify-INTEGRATION.md §2.5):线格式原样转给原版客户端 */
export type AjAction = "account" | "pay";
export interface AjGetBody {
    repCode: string;
    repData?: {
        originalImageBase64: string;
        jigsawImageBase64: string;
        token: string;
        secretKey: string;
    };
}
export interface AjCheckBody {
    repCode: string;
}
/**
 * 期望票是什么。`typ` 必填;`typ: "otp"` 必须给 purpose + subject(票只证明「这个号收到了码」)。
 * `online` 默认 true = 到服务端核销 jti(只能用一次)。`online: false` 纯离线验 —— 10 分钟内可重放,
 * **不许用于 register / reset / pay / withdraw**,只适合「重复用也无害」的展示类判断。
 */
export type TicketExpect = {
    typ: "captcha";
    action: string;
    online?: boolean;
} | {
    typ: "otp";
    purpose: OtpPurpose;
    subject: {
        channel: "sms" | "email";
        value: string;
    };
    online?: boolean;
};
export interface PayGateInput {
    token?: string | null;
    action?: string;
    remoteIp?: string;
    deviceFp?: string;
}
export type PayGateReason = "verified" | "bad-token" | "token-required" | "unavailable-open" | "unavailable-closed";
/** pass = 放行下单;challengePassed = 报给 zhifu-service 的值;verified = 真过了验证(只有它才可开免验通行证) */
export interface PayGateResult {
    pass: boolean;
    challengePassed: boolean;
    verified: boolean;
    reason: PayGateReason;
    detail?: string;
}
export type TicketResult = {
    ok: true;
    payload: TicketPayload;
} | {
    ok: false;
    reason: "invalid" | "mismatch" | "used" | "unavailable";
};
export declare function createSecurityClient(o: SecurityClientOptions): {
    captcha: {
        verify: (input: CaptchaVerifyInput) => Promise<CallResult<CaptchaVerifyBody>>;
    };
    otp: {
        send: (input: OtpSendInput) => Promise<CallResult<OtpSendBody>>;
        check: (input: OtpCheckInput) => Promise<CallResult<OtpCheckBody>>;
    };
    ticket: {
        verify: (token: string, expect: TicketExpect) => Promise<TicketResult>;
    };
    /** IP 信誉(2.35.0):check 下单前问、outcome 单终态后回报;不可用返回 null / false,绝不抛 */
    iprep: {
        check(input: import("./iprep.ts").IprepCheckInput, opts?: import("./iprep.ts").IprepCallOptions): Promise<import("./iprep.ts").IprepResult | null>;
        outcome(input: import("./iprep.ts").IprepOutcomeInput, opts?: import("./iprep.ts").IprepCallOptions): Promise<boolean>;
    };
    /**
     * AJ-Captcha 兼容适配(2.28.0):GX / F7 这类原版客户端的站点做薄代理,协议号与线格式不变。
     * - get:出题(clientIp 必填),body 原样回给客户端
     * - check:交卷,body.repCode 原样回给客户端(0000 过 / 6110 过期 / 6111 不对)
     * - bind:交卷前把题标成支付用;action 只能由服务端写死
     * - verify:核销 captchaVerification(一次性,绑站点 + 用途)。发码不用先 verify,直接把它交给 otp.send
     */
    aj: {
        get: (input: {
            clientIp: string;
        }) => Promise<CallResult<AjGetBody>>;
        check: (input: {
            token: string;
            pointJson: string;
        }) => Promise<CallResult<AjCheckBody>>;
        bind: (input: {
            token: string;
            action: AjAction;
        }) => Promise<CallResult<{
            ok: boolean;
        }>>;
        verify: (input: {
            captchaVerification: string;
            action: AjAction;
        }) => Promise<CallResult<CaptchaVerifyBody>>;
    };
    /**
     * 调用结果 → 业务动作,带上本站的 failClosed。服务可用时顺带刷新过期的策略;
     * 服务不可用时不去拉(拉也拉不到),直接用手里那份。
     */
    decide<T>(scene: Scene, r: CallResult<T>, passed: (body: T) => boolean): Promise<Decision>;
    /**
     * 支付前人机验证的统一判定(2.27.1,业主 11-01「验证服务挂了支付照常放行」):
     * - 带 token:到服务端核销;通过 → verified;被拒 → bad-token;服务不可用 → 按本站 pay 故障方向
     * - 不带 token:SDK 自己签名探一次服务;服务正常 → token-required(必须先过验证);不可用 → 按故障方向
     * 不可用 + 放行(unavailable-open)时 `challengePassed: true`(zhifu-service 每单都验的开关否则会拒单),
     * 但 `verified: false` —— 站点不要据此开「几分钟免验」通行证,并记 warn 日志。
     * 「不可用」只来自本 SDK 自己的调用失败(网络 / 超时 / 5xx / 签名配置错),玩家无法从请求里伪造。
     */
    payGate: (input: PayGateInput) => Promise<PayGateResult>;
    /** 启动时可主动拉一次 */
    refreshPolicy: () => Promise<readonly Scene[]>;
    /**
     * 这个动作要不要过人机验证(雷池中心按站按场景配,站点不留本地开关)。
     * 策略过期先拉一次;拉不到用手里那份 / 默认值(必验)。
     */
    gateRequired(action: string): Promise<boolean>;
    /** 闸门结局上报(createHumanGate 自动调;30 秒一批,失败丢弃) */
    reportGate: (action: string, outcome: GateOutcome) => void;
    /** 进程退出前可手动冲一次 */
    flushGateReports: () => Promise<void>;
    /** 场景的故障方向(当前本站策略),便于站点打日志 / 告警 */
    failMode: (scene: Scene) => "closed" | "open";
};
export type SecurityClient = ReturnType<typeof createSecurityClient>;
export { createSiteOtp, DEFAULT_OTP_MESSAGES, withMinDuration } from "./site-otp.ts";
export type { OtpCheckCode, OtpCheckResult, OtpSendCode, OtpSendResult, SiteOtp, SiteOtpChannel, SiteOtpCheckOptions, SiteOtpKv, SiteOtpMessages, SiteOtpOptions, SiteOtpProof, SiteOtpSendInput } from "./site-otp.ts";
export { createHumanGate, HUMAN_GATE_TEXT } from "./human-gate.ts";
export { DEFAULT_GATES, parseGates } from "./gate-policy.ts";
export type { GateOutcome } from "./gate-policy.ts";
export type { GateClient, HumanGate, HumanGateOptions, HumanGateResult, HumanRefusal } from "./human-gate.ts";