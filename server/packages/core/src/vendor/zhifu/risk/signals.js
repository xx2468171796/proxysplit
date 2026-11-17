export const DEFAULT_SIGNAL_REFUSE_MESSAGE = "当前账号暂时无法充值，如有疑问请联系客服";
/** Builds a source from a stored signals object (jsonb). */
export function signalSource(signals) {
    const s = signals && typeof signals === "object" ? signals : {};
    const ext = s.ext && typeof s.ext === "object" ? s.ext : {};
    const scalar = (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null;
    return {
        get: (name) => (name === "ext" ? null : (scalar(s[name]) ?? scalar(ext[name]))),
        list: (name) => {
            const v = s[name];
            return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
        },
    };
}
function compare(a, op, b) {
    if (op === "eq")
        return a === b;
    if (op === "ne")
        return a !== b;
    if (typeof a !== "number" || typeof b !== "number")
        return false;
    if (op === "gt")
        return a > b;
    if (op === "gte")
        return a >= b;
    if (op === "lt")
        return a < b;
    return op === "lte" && a <= b;
}
export function conditionHolds(c, src) {
    if (c.op === "has")
        return typeof c.value === "string" && src.list(c.signal).includes(c.value);
    const v = src.get(c.signal);
    if (c.op === "missing")
        return v === null && src.list(c.signal).length === 0;
    if (v === null)
        return false; // an absent signal never matches (rules only act on data the site sent)
    if (c.op === "in")
        return Array.isArray(c.value) && c.value.includes(v);
    return c.value !== undefined && !Array.isArray(c.value) && compare(v, c.op, c.value);
}
/** Strongest matching effect (refuse > challenge); null = nothing matched. */
export function judgeSignals(rules, signals, appId) {
    const src = signalSource(signals);
    let hit = null;
    for (const r of rules) {
        if (!r.enabled || r.when.length === 0)
            continue;
        if (r.sites && r.sites.length > 0 && !r.sites.includes(appId))
            continue;
        if (!r.when.every((c) => conditionHolds(c, src)))
            continue;
        const v = { effect: r.effect, rule: r.id, message: r.message?.trim() || DEFAULT_SIGNAL_REFUSE_MESSAGE };
        if (r.effect === "refuse")
            return v;
        hit ?? (hit = v);
    }
    return hit;
}
