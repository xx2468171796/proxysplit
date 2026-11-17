/**
 * 本站策略(故障方向 failClosed + 人机闸门 gates)的本地副本:雷池站点配置经 `GET /v1/s/policy` 下发,5 分钟刷新。
 * 拉不到沿用上一份,从没拉到过用默认值。从 index.ts 的 createSecurityClient 里拆出来(那个函数已经太长)。
 *
 * 两条硬规矩:
 * - **并发合并**:policyAt 要等响应回来才写,到期那一刻每个并发请求都会判「该拉了」,
 *   以前各发一次 GET 并各等最多一个超时(2 秒)。在途时后来者等同一个结果。
 * - **下发的 failClosed 不照单全收**:只收已知场景;有内容但一个认识的都没有 = 这份下发不可信,沿用上一份并告警
 *   (真正的空数组 `[]` 是合法的「全部故障放行」,照办)
 *   (理由见 fail-mode.ts parseFailClosed)。同一份坏配置只告警一次,不每 5 分钟刷一遍日志。
 */
import { type CallResult, type Scene } from "./fail-mode.ts";
export type PolicyResult = CallResult<{
    failClosed?: unknown;
    gates?: unknown;
}>;
export type PolicyLog = (level: "warn" | "error", msg: string, meta?: unknown) => void;
export declare const POLICY_TTL_MS = 300000;
export declare function createSitePolicy(fetchPolicy: () => Promise<PolicyResult>, now: () => number, log: PolicyLog): {
    /** 拉一次;返回这次调用的结局(payGate 用它当服务端自己的可用性探测) */
    pull(): Promise<PolicyResult>;
    /** 手里那份过了 5 分钟(或从没拉过) */
    stale: () => boolean;
    failClosed: () => readonly Scene[];
    gates: () => Readonly<Record<string, boolean>>;
};