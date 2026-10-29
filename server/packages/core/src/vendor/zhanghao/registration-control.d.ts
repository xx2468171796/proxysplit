/**
 * zhanghao/registration-control —— 注册管控:总开关 / 每日名额 / 内测码 / 一机 N 号。
 *
 * 业主:「所有项目基本都会有内测(邀请码)、设备指纹(一机一号)、防批量小号,要通用化。」
 * 这套逻辑此前困在 6E 宿主(`packages/core/src/identity/registration-*.ts`,约 800 行),5ff / V7 / 5FD 又各写了一份。
 * 现在它是 handlers `verify.register` 钩子的一个实现:在人机验证、短信/邮箱码之后、`zh.register` 之前裁决;
 * 需要与建号同生共死的两步(占名额、扣码)返回成 `beforeCreate`,由 service 在**同一事务、建号之前**执行。
 *
 * 四道闸(顺序:总开关/内测码 → 名额 → 设备):
 *   ① 总开关 `enabled=false` = **只有内测码能进**(不是全关):无码 / 码无效 → REGISTRATION_CLOSED / BETA_CODE_INVALID。
 *   ② 内测码 `off / optional / required`:optional 给了就必须有效;required 没给也算无效。
 *      扣减在事务里且是**一条原子 UPDATE**(store 契约);这里事务外只做只读预检,好给用户一句能看懂的错。
 *   ③ 每日名额(自然日,默认 Asia/Shanghai):事务外只读预检,事务里 `reserveDailySlot` 才是权威 —— 满了整个注册回滚。
 *   ④ 一机 N 号:按 `registerMeta.fingerprint` 计数;`block` 超限拒,`flag` 放行但 `registerMeta.deviceOverLimit=true`
 *      (宿主 afterCreate 据此不发注册礼包 —— 6E 的 no_gift 就是这个)。**缺指纹放行**(软闸):隐私模式 / 明文页拿不到指纹,
 *      拒了等于把真人挡在门外;要硬闸让前端不带指纹就不许提交。
 *
 * 策略本体**不在包里存**(宿主有自己的配置系统),包只每次读 `policy()` —— 别在闭包里缓存,运营改完看不到变化且不报错。
 * store 没实现某一闸的方法而策略开了它 → 抛 STORE_UNAVAILABLE(fail closed):放行等于「后台一开内测码,注册口照样裸奔」。
 */
import type { AdminContext } from "./service-contract.ts";
import type { BetaCodeListFilter, BetaCodePatch, ZhanghaoStore } from "./store/types.ts";
import { type BetaCodeRecord } from "./types.ts";
import type { RegisterDecision, VerifyRegisterContext } from "./http/handlers.ts";
export type BetaCodeMode = "off" | "optional" | "required";
export type DeviceAction = "block" | "flag";
export interface RegistrationPolicy {
    /** false = 只有内测码能注册 */
    enabled: boolean;
    /** 每自然日最多几个号;null = 不限 */
    dailyLimit: number | null;
    betaCode: BetaCodeMode;
    device: {
        /** 同一指纹最多几个号;null = 不限 */
        limit: number | null;
        /** 超限:block 拒;flag 放行但 registerMeta.deviceOverLimit=true */
        action: DeviceAction;
    };
}
/** 全开:与不接本模块时行为相同。宿主配置缺省时用它,别自己再抄一份默认值 */
export declare const OPEN_REGISTRATION_POLICY: RegistrationPolicy;
export interface RegistrationControlOptions {
    store: ZhanghaoStore;
    /** 每次裁决都读一遍(宿主配置系统热改) */
    policy: () => RegistrationPolicy | Promise<RegistrationPolicy>;
    /** 自然日时区,默认 Asia/Shanghai(北京自然日;中国大陆无夏令时) */
    timeZone?: string;
    now?: () => Date;
    /** count 模式派生码的长度,默认 8 */
    codeLength?: number;
}
export interface RegistrationStatus {
    policy: RegistrationPolicy;
    dayKey: string;
    resetAt: Date;
    dailyUsed: number | null;
    dailyRemaining: number | null;
    storeSupports: {
        betaCodes: boolean;
        dailyLimit: boolean;
        device: boolean;
    };
}
export interface CreateBetaCodesInput {
    codes?: string[];
    count?: number;
    prefix?: string;
    note?: string;
    maxUses?: number | null;
    expiresAt?: Date | null;
}
export interface RegistrationControl {
    /** 摆进 `createZhanghaoHttpHandlers(zh, { verify: { ...bits.verify, register } })`,或直接传 `registration: control` */
    verifyRegister(ctx: VerifyRegisterContext): Promise<RegisterDecision>;
    policy(): Promise<RegistrationPolicy>;
    /** 策略时区下的自然日键 YYYY-MM-DD */
    dayKey(at?: Date): string;
    status(): Promise<RegistrationStatus>;
    admin: {
        listBetaCodes(filter: Partial<BetaCodeListFilter>): Promise<(BetaCodeRecord & {
            usable: boolean;
        })[]>;
        /** ≤200;`codes` 用你的,`count` 按 ctx.requestId 确定性派生(重放同 requestId → created 为空) */
        createBetaCodes(input: CreateBetaCodesInput, ctx: AdminContext): Promise<{
            created: (BetaCodeRecord & {
                usable: boolean;
            })[];
            existing: string[];
        }>;
        updateBetaCode(id: string, patch: BetaCodePatch, ctx: AdminContext): Promise<(BetaCodeRecord & {
            usable: boolean;
        }) | null>;
    };
}
/** 内测码大小写不敏感靠**入库前统一大写**,不靠查询时 lower()(后者会让唯一索引形同虚设) */
export declare function normalizeBetaCode(raw: string | null | undefined): string;
/** 只认 64 位小写 hex(sha-256 形状);别的形状当没送(缺指纹 = 放行,所以要防客户端送个 "1" 来占位) */
export declare function normalizeFingerprint(raw: unknown): string | null;
/** 某时区下的自然日键 */
export declare function dayKeyIn(at: Date, timeZone: string): string;
/**
 * 某时区下「下一个自然日 00:00」对应的 UTC 时刻。
 * 用「格式化出来的墙钟 − 真实时刻」反推该时区此刻的偏移,再把次日零点减回去;
 * 无夏令时的时区(Asia/Shanghai)精确,有夏令时的时区在切换日可能偏一小时 —— 这里只用于展示 resetAt,不参与判闸。
 */
export declare function nextDayStartIn(at: Date, timeZone: string): Date;
/** 从 requestId 确定性派生第 i 个码:同 requestId 重放得到同一批,撞唯一索引即幂等 */
export declare function deriveBetaCode(seed: string, index: number, length: number, prefix?: string): string;
export declare function createRegistrationControl(opts: RegistrationControlOptions): RegistrationControl;