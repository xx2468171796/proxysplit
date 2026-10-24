/**
 * 规则 ⇄ JSON:宿主把规则存在配置表 / 系统设置里时用。金额(bigint)存成字符串,读回来补默认值并严格校验
 * ("false" 字符串不会被当成 true,坏金额报错而不是悄悄换成默认)。
 * 后台「分佣规则」保存:parsePolicy(body) 通过才存 policyToJson(p);读:parsePolicy(存的值)。
 */
import { assertFxPolicy, withPolicyDefaults } from "./policy.js";
export function policyToJson(p) {
    return {
        ...p,
        minBaseAmount: p.minBaseAmount.toString(),
        holdAbove: p.holdAbove.toString(),
        minWithdrawal: p.minWithdrawal.toString(),
        withdrawalFeeFixed: p.withdrawalFeeFixed.toString(),
    };
}
/** 任意 JSON → 合法 FxPolicy(缺字段补默认;不合法抛 FenxiaoError FX_POLICY_INVALID) */
export function parsePolicy(raw) {
    const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
    const p = withPolicyDefaults(o);
    assertFxPolicy(p);
    return p;
}
