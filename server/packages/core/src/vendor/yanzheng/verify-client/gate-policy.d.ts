/**
 * 人机闸门的中心策略与上报(2.41.0,业主 11-06:开关 / 参数只在雷池验证中心调,站点不留本地开关)。
 *
 * - 策略:`GET /v1/s/policy` 的 `gates`(每个场景 `{required}`),随 failClosed 一起 5 分钟刷新;
 *   拉不到沿用上一份,从没拉到过用 DEFAULT_GATES(login / register / sms / reset / pay / withdraw 必验)。
 * - 上报:每次判定的结局在内存里按 (action, outcome) 累加,30 秒一批 `POST /v1/s/gate/report`;
 *   上报失败丢弃本批(统计是给面板看的,不能拖慢 / 拖垮登录)。
 */
export type GateOutcome = "verified" | "token-required" | "bad-token" | "unavailable-open" | "unavailable-closed" | "skipped";
export declare const DEFAULT_GATES: Readonly<Record<string, boolean>>;
export declare const GATE_REPORT_INTERVAL_MS = 30000;
/** policy.gates → {场景: required};形状不对的条目忽略(沿用默认) */
export declare function parseGates(v: unknown): Record<string, boolean>;
/** 不在表里的自定义动作 = 必验(安全一侧) */
export declare const gateRequiredIn: (gates: Readonly<Record<string, boolean>>, action: string) => boolean;
export declare function createGateReporter(send: (items: Array<{
    action: string;
    outcome: GateOutcome;
    n: number;
}>) => Promise<unknown>, intervalMs?: number): {
    record(action: string, outcome: GateOutcome): void;
    flush: () => Promise<void>;
};
/**
 * 「中心可用吗」探测的短缓存:正常 10 秒、不可用 2 秒(尽快重试,别把一次抖动放大),并发合并成一次。
 * 没有它,每个无票请求都签名打一次中心,刷无票登录可把中心拖超时、逼出全站放行(审计 S1,11-06)。
 */
export declare function createProbeCache(pull: () => Promise<{
    status: string;
    reason?: string;
}>, now: () => number): () => Promise<{
    ok: boolean;
    reason: string;
}>;