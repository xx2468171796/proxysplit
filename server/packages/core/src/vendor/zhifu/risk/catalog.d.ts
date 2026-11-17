/**
 * 支付风控规则目录（业主 2026-11-04「整套风控做成标准、可开关」）。
 *
 * 每条规则 = 一个开关 `enabled` + 一组参数，按 全局 → 通道 → 站点 三层覆盖（越具体越优先，见 `resolve.ts`）。
 * 这里只定义「有哪些规则、能在哪层改、默认是什么」；值存哪、怎么缓存由消费方（zhifu-service）实现 `RiskStore`。
 * 纯数据，无 I/O。
 */
export type RiskScope = "global" | "channel" | "site";
export type RiskParamValue = number | boolean | readonly number[];
export type RiskParams = Readonly<Record<string, RiskParamValue>>;
export declare const RISK_RULE_IDS: readonly ["queue", "ladder", "openOrder", "repull", "device", "ip", "burst", "payerRelax", "trust", "challenge", "orderGeo", "scanToCreate", "scanClient", "allowTablet", "scanIp", "scanTiming", "scanRate"];
export type RiskRuleId = (typeof RISK_RULE_IDS)[number];
export interface RiskRuleDef {
    id: RiskRuleId;
    label: string;
    group: "下单" | "未付" | "跨账号" | "扫码";
    description: string;
    /** 能在哪几层覆盖。下单前判定（还没选通道）的规则没有 channel 层；逐站开关类只有 site 层。 */
    scopes: readonly RiskScope[];
    /**
     * true = 「全部风控关闭」不动它，紧急关闭期间仍可单独开关。这类规则保护的是通道本身，不是拦玩家的风控：
     * 排队（通道到账）、扫码才建单（机器人刷单打不到上游；签名 / 过期 / 每单只建一个上游单随它生效）。
     * 业主 2026-11-04：紧急关闭只放开风控，不放开通道保护。
     */
    essential: boolean;
    defaultEnabled: boolean;
    defaults: RiskParams;
}
export declare const RISK_RULES: readonly RiskRuleDef[];
export declare function riskRule(id: string): RiskRuleDef | null;
export declare function isRiskRuleId(id: string): id is RiskRuleId;
/** 规则 orderGeo 拦下时给玩家的默认文案（中心可改，见 pay.controls orderGeo.message）。 */
export declare const DEFAULT_ORDER_GEO_MESSAGE = "\u68C0\u6D4B\u5230\u4F60\u6B63\u5728\u4F7F\u7528\u5883\u5916\u7F51\u7EDC\u6216\u4EE3\u7406\uFF08VPN / \u52A0\u901F\u5668\uFF09\uFF0C\u6682\u65F6\u65E0\u6CD5\u5145\u503C\u3002\u8BF7\u5173\u95ED VPN\uFF0C\u6216\u628A\u624B\u673A\u5207\u6362\u5230\u79FB\u52A8\u6570\u636E\uFF084G / 5G\uFF09\u540E\u518D\u8BD5";