/**
 * Signal rules (6.5, owner 11-05「以后的决策数据随时能加」): the risk engine reads `PayCreateRequest.signals` by
 * name. A rule = conditions on named signals → effect. Rules live in the center param `risk.signalRules`
 * (风控总台 / 参数页, JSON), so a new signal needs no deploy: the site sends it, the owner writes a rule on it.
 * Pure: no I/O, no zod (the schema is in `zhifu/contracts`).
 */
export type SignalScalar = string | number | boolean;
export type SignalOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "has" | "missing";
export type SignalEffect = "challenge" | "refuse";
export interface SignalCondition {
    signal: string;
    op: SignalOp;
    /** Not used by `missing`; an array for `in`. */
    value?: SignalScalar | readonly SignalScalar[];
}
export interface SignalRule {
    id: string;
    enabled: boolean;
    /** Only these site app ids (empty / absent = every site). */
    sites?: readonly string[];
    /** All conditions must hold. */
    when: readonly SignalCondition[];
    effect: SignalEffect;
    /** Shown to the player on `refuse` (default: 暂时无法充值). */
    message?: string;
}
export interface SignalSource {
    /** Scalar by name (known key, then ext); null when absent. */
    get(name: string): SignalScalar | null;
    /** Array signal membership (e.g. accountFlags has "new_device"). */
    list(name: string): readonly string[];
}
export declare const DEFAULT_SIGNAL_REFUSE_MESSAGE = "\u5F53\u524D\u8D26\u53F7\u6682\u65F6\u65E0\u6CD5\u5145\u503C\uFF0C\u5982\u6709\u7591\u95EE\u8BF7\u8054\u7CFB\u5BA2\u670D";
/** Builds a source from a stored signals object (jsonb). */
export declare function signalSource(signals: unknown): SignalSource;
export declare function conditionHolds(c: SignalCondition, src: SignalSource): boolean;
export interface SignalVerdict {
    effect: SignalEffect;
    rule: string;
    message: string;
}
/** Strongest matching effect (refuse > challenge); null = nothing matched. */
export declare function judgeSignals(rules: readonly SignalRule[], signals: unknown, appId: string): SignalVerdict | null;