import { capReject, inTimeWindows, stateReject } from "./rules.js";
const STATE_TEXT = {
    paused: "已暂停",
    "circuit-open": "熔断中（连续下单失败）",
};
const CAP_TEXT = {
    "daily-amount": "已到当日限额",
    "monthly-amount": "已到当月限额",
    "daily-count": "已到当日笔数上限",
};
/** 已启用 is the switch; 生效中 = enabled AND healthy AND in window AND under caps. Pure, every reason listed. */
export function liveStatus(i) {
    const reasons = [];
    if (!i.enabled)
        reasons.push("未启用");
    const base = { rule: i.rule, facts: i.facts, appId: "", amountCents: 1n, isSplit: false, now: i.now };
    // amount 1 cent: "at the cap" already means no further payment fits.
    const st = stateReject({ ...base, rule: { ...i.rule, sites: [], noSplit: false } });
    if (st)
        reasons.push(st === "paused" && i.rule.pauseReason ? `已暂停：${i.rule.pauseReason}` : (STATE_TEXT[st] ?? st));
    if (i.healthState === "open")
        reasons.push("健康熔断（自动暂停）");
    if (!inTimeWindows(i.rule.timeWindows, i.now))
        reasons.push(`不在时段 ${(i.rule.timeWindows ?? []).join("、")}`);
    const cap = capReject(base);
    if (cap)
        reasons.push(CAP_TEXT[cap] ?? cap);
    if (i.weight <= 0)
        reasons.push("权重为 0（不参与自动分配）");
    if (!i.hasCredentials)
        reasons.push("未配置凭据");
    if (i.gatewayActive === false)
        reasons.push("中转站侧已停用");
    return { live: reasons.length === 0, reasons };
}
