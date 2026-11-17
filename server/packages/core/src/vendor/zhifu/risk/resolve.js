export const EMERGENCY_OFF = { active: false, since: null, by: null, reason: null };
function layersFor(def, overrides, target) {
    const pick = (scope, key) => key === null || key === undefined || !def.scopes.includes(scope)
        ? undefined
        : overrides.find((o) => o.rule === def.id && o.scope === scope && o.scopeKey === key);
    return [pick("global", ""), pick("channel", target.channel), pick("site", target.site)].filter((o) => o !== undefined);
}
export function resolveRule(def, base, overrides, target, emergency) {
    let enabled = base.enabled;
    let enabledFrom = "base";
    const params = { ...base.params };
    const paramsFrom = Object.fromEntries(Object.keys(params).map((k) => [k, "base"]));
    for (const o of layersFor(def, overrides, target)) {
        if (o.enabled !== null) {
            enabled = o.enabled;
            enabledFrom = o.scope;
        }
        for (const [k, v] of Object.entries(o.params ?? {})) {
            if (!Object.keys(params).includes(k))
                continue; // 目录里没有的参数键不认（旧数据 / 手误）
            params[k] = v;
            paramsFrom[k] = o.scope;
        }
    }
    if (emergency && !def.essential && enabled)
        return { rule: def.id, enabled: false, enabledFrom: "emergency", params, paramsFrom };
    return { rule: def.id, enabled, enabledFrom, params, paramsFrom };
}
/** 紧急关闭前后逐格比对：返回开关不一致的格子（恢复后应为空）。 */
export function diffEnabled(before, after) {
    const now = new Map(after.map((c) => [c.key, c.enabled]));
    return before.filter((c) => now.get(c.key) !== c.enabled).map((c) => c.key);
}
