/**
 * 规则:默认值、合法性校验、按人取比例、按商品取规则。纯函数,没有 IO。
 */
import { type FxPolicy, type FxProductRule, type FxTier } from "./types.ts";
export declare const BPS = 10000;
/** 上级链最长存多少级(多存几级给后台看团队;分佣只取前 maxLevels 级) */
export declare const MAX_CHAIN = 20;
/** 不开 allowDeepLevels 时最多返几级 */
export declare const SAFE_LEVELS = 3;
/** 开了 allowDeepLevels 也最多返几级 */
export declare const MAX_LEVELS = 10;
export declare const DEFAULT_FX_POLICY: FxPolicy;
/** 宿主存的规则可能是旧版本(少字段):先补默认值再用 */
export declare function withPolicyDefaults(p: Partial<FxPolicy>): FxPolicy;
export declare const MONEY_KEYS: readonly ["minBaseAmount", "holdAbove", "minWithdrawal", "withdrawalFeeFixed"];
/** 整数金额:bigint / 安全整数 number / 整数字符串 → bigint;别的 → null */
export declare function toMoney(v: unknown): bigint | null;
export declare function assertRates(rates: number[], field: string): void;
export declare function assertFxPolicy(p: FxPolicy): void;
export declare function findTier(policy: FxPolicy, code: string | null): FxTier | null;
export declare function productRule(policy: FxPolicy, key: string | null | undefined): FxProductRule | null;
/**
 * 某位上级能拿的逐级比例:停用 → null;逐人覆盖 > 等级 > (人人可推广时)默认;都没有 → null。
 * 等级 code 在规则里找不到(后台删了档)按普通用户处理,不会因为删档把人卡死。
 */
export declare function ratesFor(policy: FxPolicy, m: {
    enabled: boolean;
    tierCode: string | null;
    rateOverride: number[] | null;
}): number[] | null;
/** 能不能推广(领码):设了有效等级,或人人可推广 */
export declare function canPromote(policy: FxPolicy, m: {
    enabled: boolean;
    tierCode: string | null;
} | null): boolean;
/** 提现手续费:比例 + 固定额,不超过金额本身 */
export declare function withdrawalFee(policy: FxPolicy, amount: bigint): bigint;