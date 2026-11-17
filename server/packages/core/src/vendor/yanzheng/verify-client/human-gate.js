/** 玩家看到的拒绝文案(各站统一;要改改这里,别在站点里另写) */
export const HUMAN_GATE_TEXT = {
    "token-required": "请先完成安全验证",
    "bad-token": "安全验证已失效，请重新验证",
    busy: "安全验证服务繁忙，请稍后再试",
};
const refusalOf = (reason) => reason === "unavailable-closed" ? "busy" : reason === "bad-token" ? "bad-token" : "token-required";
export function createHumanGate(o) {
    const warn = o.warn ?? (() => undefined);
    return {
        async check(token, action, ctx = {}) {
            if (o.enabled && !(await o.enabled(action)))
                return { pass: true, verified: false, reason: "unavailable-open" };
            const c = o.client();
            if (!c) {
                warn("verify center not configured, let through", { action, ip: ctx.remoteIp });
                return { pass: true, verified: false, reason: "unavailable-open" };
            }
            const report = (x) => { try {
                c.reportGate?.(action, x);
            }
            catch { /* 统计不影响判定 */ } };
            if (c.gateRequired && !(await c.gateRequired(action).catch(() => true))) {
                report("skipped");
                return { pass: true, verified: false, reason: "skipped" };
            }
            const g = await c.payGate({ token, action, remoteIp: ctx.remoteIp, deviceFp: ctx.deviceFp });
            report(g.reason);
            if (g.reason === "unavailable-open")
                warn("verify unavailable, fail-open", { action, ip: ctx.remoteIp, detail: g.detail, hadToken: Boolean(token) });
            if (g.pass)
                return { pass: true, verified: g.verified, reason: g.reason };
            const refusal = refusalOf(g.reason);
            warn("human gate refused", { action, ip: ctx.remoteIp, reason: g.reason, detail: g.detail });
            return { pass: false, refusal, message: HUMAN_GATE_TEXT[refusal], reason: g.reason, ...(g.detail === undefined ? {} : { detail: g.detail }) };
        },
    };
}
