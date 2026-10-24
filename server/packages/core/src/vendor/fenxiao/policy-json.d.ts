/**
 * 规则 ⇄ JSON:宿主把规则存在配置表 / 系统设置里时用。金额(bigint)存成字符串,读回来补默认值并严格校验
 * ("false" 字符串不会被当成 true,坏金额报错而不是悄悄换成默认)。
 * 后台「分佣规则」保存:parsePolicy(body) 通过才存 policyToJson(p);读:parsePolicy(存的值)。
 */
import { type MONEY_KEYS } from "./policy.ts";
import type { FxPolicy } from "./types.ts";
export type FxPolicyJson = Omit<FxPolicy, (typeof MONEY_KEYS)[number]> & Record<(typeof MONEY_KEYS)[number], string>;
export declare function policyToJson(p: FxPolicy): FxPolicyJson;
/** 任意 JSON → 合法 FxPolicy(缺字段补默认;不合法抛 FenxiaoError FX_POLICY_INVALID) */
export declare function parsePolicy(raw: unknown): FxPolicy;