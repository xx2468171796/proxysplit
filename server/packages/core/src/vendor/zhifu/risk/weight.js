import { unpaidWeight } from "../order/open-rules.js";
const NEVER_PAID = new Set(["expired", "cancelled"]);
export function orderWeight(o, w) {
    const base = unpaidWeight(o, w);
    const unscanned = o.scanToCreate === true && !o.scannedAt && NEVER_PAID.has(o.status);
    return unscanned ? base * (w.unscannedWeight ?? 1) : base;
}
/** 倒序累加，遇到已付停，向下取整。 */
export function scanWeightedStreak(recent, w) {
    let n = 0;
    for (const o of recent) {
        if (o.status === "paid" || o.status === "partial")
            break;
        n += orderWeight(o, w);
    }
    return Math.floor(n + 1e-9);
}
