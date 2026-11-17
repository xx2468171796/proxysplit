import { pickCandidate } from "./rules.js";
/** Codes allowed for this amount by the first matching amount route; null = no route matched (all allowed). */
export function amountRouteCodes(routes, amountCents) {
    for (const r of routes) {
        const fixed = r.fixedCents ?? [];
        const hit = fixed.length > 0
            ? fixed.some((c) => BigInt(c) === amountCents)
            : (r.minCents === undefined || amountCents >= BigInt(r.minCents)) &&
                (r.maxCents === undefined || amountCents <= BigInt(r.maxCents));
        if (hit)
            return [...r.channels];
    }
    return null;
}
/** The amount routes that apply to a site: its own (even an empty list = unrestricted) else the global ones. Pure. */
export function effectiveAmountRoutes(site, global) {
    return site ?? global;
}
/**
 * Rotation cursor key: one cursor per (site, mode, candidate set), so each site rotates independently and a
 * change in the usable set (a channel paused / capped) starts a fresh rotation instead of skewing an old one.
 */
export function cursorKey(appId, mode, codes) {
    return `${appId}|${mode}|${[...codes].sort().join(",")}`;
}
/** Modes that rotate through a cursor (one atomic counter per cursor key, safe across api instances). */
export function needsCursor(mode) {
    return mode === "round_robin" || mode === "weighted_round_robin";
}
const stable = (list) => [...list].sort((a, b) => a.priority - b.priority || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
/** Smooth weighted round robin (nginx): A:3 B:1 → A A B A, spread out instead of bursts. Pure. */
export function smoothWeightedSequence(list) {
    const items = stable(list).filter((c) => c.weight > 0);
    const total = items.reduce((s, c) => s + c.weight, 0);
    const current = items.map(() => 0);
    const out = [];
    for (let n = 0; n < total; n++) {
        let best = 0;
        for (let i = 0; i < items.length; i++) {
            current[i] = (current[i] ?? 0) + (items[i]?.weight ?? 0);
            if ((current[i] ?? 0) > (current[best] ?? 0))
                best = i;
        }
        current[best] = (current[best] ?? 0) - total;
        const chosen = items[best];
        if (chosen)
            out.push(chosen);
    }
    return out;
}
/**
 * Choose among channels that already passed their own rules. Weight 0 = never picked automatically
 * (in every mode), so staff can park a channel without disabling it.
 */
export function pickByMode(mode, candidates, o) {
    const usable = stable(candidates.filter((c) => c.weight > 0));
    if (usable.length === 0)
        return null;
    switch (mode) {
        case "round_robin":
            return usable[Number(o.cursor % BigInt(usable.length))] ?? null;
        case "weighted_round_robin": {
            const seq = smoothWeightedSequence(usable);
            return seq[Number(o.cursor % BigInt(seq.length))] ?? null;
        }
        case "random":
            return usable[Math.min(usable.length - 1, Math.floor(o.random() * usable.length))] ?? null;
        case "priority_failover":
            return pickCandidate(usable, o.random);
    }
}
