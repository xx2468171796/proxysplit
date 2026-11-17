import type { RiskParams, RiskParamValue, RiskRuleDef, RiskRuleId, RiskScope } from "./catalog.ts";
/**
 * 三层覆盖求值（纯函数）：基础值 → 全局覆盖 → 通道覆盖 → 站点覆盖，越具体越优先；
 * `enabled` 和每个参数分别取「最具体的那一层有值的」。紧急「全部风控关闭」时非 essential 规则一律关
 * （essential = 排队、扫码才建单，保护通道，照常求值），覆盖记录原样不动 —— 恢复 = 取消紧急状态，结果和关闭前逐格一致。
 */
/** 一条覆盖记录。`enabled` / `params` 为 null = 这层不管（继承上层）；params 可只写部分键。 */
export interface RiskOverride {
    scope: RiskScope;
    /** global = ""；channel = 通道 code；site = 站点 appId */
    scopeKey: string;
    rule: RiskRuleId;
    enabled: boolean | null;
    params: RiskParams | null;
}
/** 规则在最底层的值（消费方从旧配置算出来，保证迁移前后不变）。 */
export interface RiskBase {
    enabled: boolean;
    params: RiskParams;
}
export interface RiskTarget {
    channel?: string | null;
    site?: string | null;
}
export type RiskSource = "base" | RiskScope | "emergency";
export interface EffectiveRule {
    rule: RiskRuleId;
    enabled: boolean;
    enabledFrom: RiskSource;
    params: Record<string, RiskParamValue>;
    paramsFrom: Record<string, RiskSource>;
}
export interface EmergencyState {
    active: boolean;
    since: string | null;
    by: string | null;
    reason: string | null;
}
export declare const EMERGENCY_OFF: EmergencyState;
export declare function resolveRule(def: RiskRuleDef, base: RiskBase, overrides: readonly RiskOverride[], target: RiskTarget, emergency: boolean): EffectiveRule;
/** 紧急关闭前后逐格比对：返回开关不一致的格子（恢复后应为空）。 */
export declare function diffEnabled(before: readonly {
    key: string;
    enabled: boolean;
}[], after: readonly {
    key: string;
    enabled: boolean;
}[]): string[];