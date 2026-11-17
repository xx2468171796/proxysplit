export const DEFAULT_GATES = Object.freeze({
    login: true, browse: false, register: true, sms: true, reset: true, pay: true, withdraw: true, play: true,
});
const ACTION_RE = /^[a-z_]{1,32}$/;
const MAX_ITEMS = 50;
export const GATE_REPORT_INTERVAL_MS = 30000;
/** policy.gates → {场景: required};形状不对的条目忽略(沿用默认) */
export function parseGates(v) {
    const out = { ...DEFAULT_GATES };
    if (!v || typeof v !== "object" || Array.isArray(v))
        return out;
    for (const [k, g] of Object.entries(v)) {
        if (!ACTION_RE.test(k) || !g || typeof g !== "object")
            continue;
        const req = g.required;
        if (typeof req === "boolean")
            out[k] = req;
    }
    return out;
}
/** 不在表里的自定义动作 = 必验(安全一侧) */
export const gateRequiredIn = (gates, action) => gates[action] ?? true;
export function createGateReporter(send, intervalMs = GATE_REPORT_INTERVAL_MS) {
    const counts = new Map();
    let timer;
    async function flush() {
        if (!counts.size)
            return;
        const items = [...counts].slice(0, MAX_ITEMS).map(([k, n]) => {
            const [action, outcome] = k.split("|");
            return { action, outcome, n };
        });
        for (const it of items)
            counts.delete(`${it.action}|${it.outcome}`);
        await send(items).catch(() => undefined);
    }
    return {
        record(action, outcome) {
            if (!ACTION_RE.test(action))
                return;
            const k = `${action}|${outcome}`;
            counts.set(k, Math.min((counts.get(k) ?? 0) + 1, 100000));
            if (!timer) {
                timer = setInterval(() => void flush(), intervalMs);
                timer.unref?.();
            }
        },
        flush,
    };
}
/**
 * 「中心可用吗」探测的短缓存:正常 10 秒、不可用 2 秒(尽快重试,别把一次抖动放大),并发合并成一次。
 * 没有它,每个无票请求都签名打一次中心,刷无票登录可把中心拖超时、逼出全站放行(审计 S1,11-06)。
 */
export function createProbeCache(pull, now) {
    let last = { at: -Infinity, ok: false, reason: "" };
    let inflight = null;
    return async () => {
        if (now() - last.at < (last.ok ? 10000 : 2000))
            return last;
        inflight ?? (inflight = pull().then((r) => {
            last = { at: now(), ok: r.status !== "unavailable", reason: r.status === "unavailable" ? (r.reason ?? "") : "" };
            return last;
        }).finally(() => { inflight = null; }));
        return inflight;
    };
}
