import type { OtpPurpose, SecurityClient } from "./index.ts";
import { withMinDuration } from "./site-otp-util.ts";
export type SiteOtpChannel = "sms" | "email";
/** 失败种类(站点据此映射自己的错误码 / 文案;message 是默认中文) */
export type OtpSendCode = "sent" | "busy" | "captcha" | "cooldown" | "quota" | "blocked-prefix" | "bad-recipient" | "send-failed" | "refused";
export type OtpCheckCode = "ok" | "format" | "busy" | "no-code" | "wrong" | "expired";
export interface OtpSendResult {
    ok: boolean;
    code: OtpSendCode;
    message: string;
    retryAfterSec?: number;
    budgetExhausted?: boolean;
    sendFailed?: boolean;
    /** 人机票被拒(要重新过验证) */
    captchaFailed?: boolean;
    /** 中心不可用 / 本站没配好(fail-closed) */
    busy?: boolean;
    /** busy 的来由:center-unavailable = 中心调用不可用;其余(本站配置 / KV)不带 */
    reason?: "center-unavailable";
    /** 中心拒绝时的原始错误码与限额桶(2.31.0;站点要保留自己的细分文案时用,如 subject_day 每号每日上限) */
    centerError?: string;
    bucket?: string;
}
export interface OtpCheckResult {
    ok: boolean;
    code: OtpCheckCode;
    message: string;
    /** 中心给出的剩余尝试次数(只在 code=wrong 且来自中心时有) */
    attemptsLeft?: number;
}
/** 站点 KV(一般是 Redis)里用到的操作 */
export interface SiteOtpKv {
    get(k: string): Promise<string | null>;
    set(k: string, v: string, ttlSec: number): Promise<unknown>;
    del(k: string): Promise<unknown>;
    getdel(k: string): Promise<string | null>;
    /** 自增并在首次设过期,返回新值 */
    incr(k: string, ttlSec: number): Promise<number>;
}
export interface SiteOtpMessages {
    busy: string;
    captcha: string;
    sent: string;
    noCode: string;
    wrong: string;
    /** 带剩余次数的错码,{n} 替换为次数 */
    wrongLeft: string;
    expired: string;
    format: string;
}
export declare const DEFAULT_OTP_MESSAGES: SiteOtpMessages;
export interface SiteOtpOptions {
    /** null = 本站没配凭据(开关开着却没配 = 配置错误,一律 busy) */
    client: () => SecurityClient | null;
    kv: () => SiteOtpKv | null | Promise<SiteOtpKv | null>;
    /** 键前缀,如 `v7:lcvotp:`(每站唯一) */
    keyPrefix: string;
    log?: (level: "warn" | "error", msg: string, meta?: unknown) => void;
    /** 发码遇中心不可用 / CHANNEL_NOT_CONFIGURED 时调(单条 SEND_FAILED 不算:玩家发到空号就能触发) */
    onOutage?: (channel: SiteOtpChannel) => void | Promise<void>;
    /** peek 后错码累计满这么多次就丢暂存票据(第 N 次错即作废),默认 3 */
    maxPeekMisses?: number;
    /** peek 暂存上限秒数,默认 600;实际还受票据 exp 约束 */
    peekTtlSec?: number;
    /** 码格式,默认 6 位数字 */
    codePattern?: RegExp;
    messages?: Partial<SiteOtpMessages>;
    /**
     * 暂存哈希密钥(2.31.0):传本站 LCV 站点密钥(与 createSecurityClient 的 secret 同一个)。
     * 传了暂存里的码哈希改成 HMAC,拿到 KV 读权限也没法离线穷举 6 位码;不传退回旧的纯 sha256(兼容 2.29/2.30)。
     */
    stashSecret?: string;
    /**
     * 允许 `captchaExempt: true` 的用途(2.31.0),须与雷池面板该站 captchaExempt 一致;默认空 = 本地一律拒豁免。
     * 本地先拦,中心豁免表与本站不一致时 sendIfExists / refuse 两条路才会同一个答案(否则能借差异探号)。
     * 豁免用途别配 refuse(零成本占用探测)。
     */
    exemptPurposes?: readonly OtpPurpose[];
    /** 测试缝:时钟(毫秒) */
    now?: () => number;
}
/**
 * 人机凭证三选一(同 OtpSendInput,2.31.0 起 createSiteOtp 也收 AJ 两种):
 * - captchaTicket:LcVerify 的票;
 * - captchaVerification:AJ 适配通行(GX / F7 原版 Laya 客户端过滑块后自算的那串,用途 account);
 * - captchaExempt: true:雷池站点配置豁免的用途。**只能由站点服务端在确定流程里写死,绝不透传玩家字段**。
 * 空串一律当「没过人机」。
 */
export type SiteOtpProof = {
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
};
export type SiteOtpSendInput = {
    channel: SiteOtpChannel;
    to: string;
    purpose: OtpPurpose;
    clientIp: string;
    deviceFp?: string | null;
    /**
     * 自定义存储键(2.31.0):把码钉在某个具体操作上(如 `acct:<user>:<phone>:<type>`)。
     * 给了就用它替代默认的「通道 + 用途 + 对象」键;check 时必须传同一个 intent,别的操作花不掉这条码。
     */
    intent?: string;
} & SiteOtpProof;
export interface SiteOtpCheckOptions {
    /** 与 send 时同一个 intent */
    intent?: string;
}
export { withMinDuration };
export declare function createSiteOtp(o: SiteOtpOptions): {
    send: (i: SiteOtpSendInput, refuse?: () => Promise<string | null>) => Promise<OtpSendResult>;
    sendIfExists: (i: SiteOtpSendInput, exists: () => Promise<boolean>, opts: {
        generic: string;
        minMs: number;
    }) => Promise<OtpSendResult>;
    check: (channel: SiteOtpChannel, to: string, purpose: OtpPurpose, code: string, consume: boolean, opts?: SiteOtpCheckOptions) => Promise<OtpCheckResult>;
    proofOnly: (proof: SiteOtpProof, remoteIp: string, purpose: OtpPurpose) => Promise<OtpSendResult>;
    captchaOnly: (token: string, remoteIp: string) => Promise<OtpSendResult>;
};
export type SiteOtp = ReturnType<typeof createSiteOtp>;