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
import { DEFAULT_FAIL_CLOSED, parseFailClosed } from "./fail-mode.js";
import { DEFAULT_GATES, parseGates } from "./gate-policy.js";
export const POLICY_TTL_MS = 300000;
export function createSitePolicy(fetchPolicy, now, log) {
    let failClosed = DEFAULT_FAIL_CLOSED;
    let gates = { ...DEFAULT_GATES };
    let policyAt = 0;
    let warned = "";
    let pulling = null;
    function applyFailClosed(raw) {
        const parsed = parseFailClosed(raw);
        if (!parsed)
            return;
        /* 真正的空数组是合法配置,照办:雷池站点配置允许 failClosed: [](edge/hv/sites.mjs 只要求是场景名的子集),
           含义就是「本站所有场景故障时都放行」,那是业主在中心明确选的。
           不可信的是「数组里有东西、却一个认识的都没有」(大小写拼错、塞了别的类型)—— 那是写坏了,
           不能让写坏的后果变成防线消失,所以沿用上一份。 */
        const usable = parsed.scenes.length > 0 || parsed.dropped.length === 0;
        if (usable)
            failClosed = parsed.scenes;
        if (usable && parsed.dropped.length === 0)
            return;
        const sig = JSON.stringify(raw);
        if (sig === warned)
            return;
        warned = sig;
        log("warn", usable ? "policy failClosed has unknown scenes, ignored them" : "policy failClosed has no known scene, keeping previous", { received: raw, effective: failClosed });
    }
    async function pullOnce() {
        const r = await fetchPolicy();
        policyAt = now();
        if (r.status === "ok")
            applyFailClosed(r.body.failClosed);
        if (r.status === "ok" && r.body.gates !== undefined)
            gates = parseGates(r.body.gates);
        return r;
    }
    return {
        /** 拉一次;返回这次调用的结局(payGate 用它当服务端自己的可用性探测) */
        pull() {
            pulling ?? (pulling = pullOnce().finally(() => {
                pulling = null;
            }));
            return pulling;
        },
        /** 手里那份过了 5 分钟(或从没拉过) */
        stale: () => now() - policyAt > POLICY_TTL_MS,
        failClosed: () => failClosed,
        gates: () => gates,
    };
}
