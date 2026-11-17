import { z } from "zod";
/** Minute of the Beijing (UTC+8) day, 0–1439. */
export function beijingMinuteOfDay(at) {
    const shifted = new Date(at.getTime() + 8 * 3600000);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}
/** A channel rule failed save-time validation; `field` names the bad field (hosts map it to a 400). */
export class ChannelRuleError extends Error {
    constructor(message, field) {
        super(message);
        this.name = "ChannelRuleError";
        this.field = field;
    }
}
const isoTime = z.string().refine((v) => Number.isFinite(Date.parse(v)), "不是有效的时间");
const hhmmWindow = z.string().refine((v) => parseWindow(v) !== null, "时间段格式应为 HH:mm-HH:mm（00:00–24:00）");
/**
 * Channel routing rules (ported from 中转站 `channel-rules.ts`, amounts converted to cents).
 * Save path = `strictChannelRule` (one bad field → field error). Runtime = `parseChannelRule`, tolerant per
 * field: a broken field drops only itself ("no limit"), except an unparsable pause, which counts as paused.
 */
export const channelRuleSchema = z.object({
    sites: z.array(z.string()).optional(),
    amountMinCents: z.number().int().nonnegative().optional(),
    amountMaxCents: z.number().int().nonnegative().optional(),
    /** Only these exact amounts (cents); empty / missing = any amount inside min / max. */
    fixedAmountsCents: z.array(z.number().int().positive()).optional(),
    dailyAmountCapCents: z.number().int().nonnegative().optional(),
    monthlyAmountCapCents: z.number().int().nonnegative().optional(),
    dailyCountCap: z.number().int().nonnegative().optional(),
    minIntervalSec: z.number().int().nonnegative().optional(),
    timeWindows: z.array(hhmmWindow).optional(),
    noSplit: z.boolean().optional(),
    failureThreshold: z.number().int().positive().optional(),
    failureCooldownSec: z.number().int().positive().optional(),
    /** 二维码有效期 (s): caps the shown QR expiry when the upstream doesn't report the real one; missing = upstream. */
    qrTtlSec: z.number().int().min(30).max(86400).optional(),
    /** Upstream product text: "date5" = 订单号：YYYYMMDD + 5-digit daily sequence (zyg1103); "catalog" (6.14) = a neutral product name from the host's editable catalog (center param `upstream.subjectCatalog`); missing = order subject. */
    subjectFormat: z.enum(["date5", "catalog"]).optional(),
    /** Pay presentation (`zhifu/presentation`): 二维码模式 all / desktop / off; missing = site → default "all". */
    qrMode: z.enum(["all", "desktop", "off"]).optional(),
    /** Line under the phone jump button; missing = site → default copy. */
    jumpHint: z.string().trim().min(1).max(120).optional(),
    /**
     * 6.14 payer scenes this channel serves (decided at order creation, `zhifu/presentation` detectPayScene):
     * e.g. ["mobile"] = phones only, ["desktop","tablet","unknown"] = everything else; missing / empty = all.
     */
    scenes: z.array(z.enum(["desktop", "mobile", "tablet", "unknown"])).optional(),
    /**
     * 6.15 merchant-facing base for THIS channel (notify / return / cashier relay), e.g. the domain registered in the
     * Alipay open platform; https origin only; missing = the center's own base. Hosts must allowlist it.
     */
    merchantBase: z
        .string()
        .regex(/^https:\/\/[a-z0-9.-]+$/i, "只能是 https://域名（不带路径、端口）")
        .optional(),
    pausedUntil: isoTime.optional(),
    pauseReason: z.string().optional(),
});
/** Far-future pause used for "until resumed" and for a pause value that cannot be read. */
export const PAUSED_FOREVER = "2099-12-31T16:00:00.000Z";
/** Save-time validation: unknown keys or any invalid field → `ChannelRuleError` naming the field. */
export function strictChannelRule(raw) {
    const parsed = channelRuleSchema.strict().safeParse(raw ?? {});
    if (parsed.success)
        return parsed.data;
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || (issue?.code === "unrecognized_keys" ? issue.keys.join("、") : "rule");
    throw new ChannelRuleError(`通道规则字段 ${field} 不对：${issue?.message ?? "格式错误"}`, field);
}
/** Runtime: field-by-field, so one dirty field never wipes the others (least of all the pause). */
export function parseChannelRule(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return {};
    const src = raw;
    const out = {};
    for (const [key, field] of Object.entries(channelRuleSchema.shape)) {
        if (src[key] === undefined)
            continue;
        const r = field.safeParse(src[key]);
        if (r.success)
            out[key] = r.data;
        else if (key === "timeWindows" && Array.isArray(src[key]))
            out[key] = src[key].filter((w) => typeof w === "string" && parseWindow(w) !== null);
    }
    if (src.pausedUntil !== undefined && out.pausedUntil === undefined) {
        out.pausedUntil = PAUSED_FOREVER;
        out.pauseReason = typeof src.pauseReason === "string" ? src.pauseReason : "暂停时间无法解析，按暂停处理";
    }
    return out;
}
/** Rules whose check depends on concurrent picks: routing takes the per-channel lock and re-checks. */
export function needsClaim(rule) {
    return Boolean(rule.minIntervalSec || rule.dailyAmountCapCents || rule.monthlyAmountCapCents || rule.dailyCountCap);
}
function parseHhmm(text) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m)
        return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h === 24 && min === 0)
        return 24 * 60;
    return h < 24 && min < 60 ? h * 60 + min : null;
}
function parseWindow(w) {
    const [a, b] = w.split("-");
    const from = a === undefined ? null : parseHhmm(a);
    const to = b === undefined ? null : parseHhmm(b);
    return from === null || to === null ? null : [from, to];
}
/** Beijing-time windows "HH:mm-HH:mm", overnight allowed; empty = all day; unparsable entries ignored. */
export function inTimeWindows(windows, now) {
    const ranges = (windows ?? []).map(parseWindow).filter((r) => r !== null);
    if (ranges.length === 0)
        return true;
    const cur = beijingMinuteOfDay(now);
    return ranges.some(([from, to]) => (from <= to ? cur >= from && cur <= to : cur >= from || cur <= to));
}
export function capReject(input) {
    const { rule, facts, amountCents } = input;
    const pending = facts.openCents + amountCents;
    if (rule.dailyAmountCapCents && facts.paidTodayCents + pending > BigInt(rule.dailyAmountCapCents)) {
        return "daily-amount";
    }
    if (rule.monthlyAmountCapCents && facts.paidMonthCents + pending > BigInt(rule.monthlyAmountCapCents)) {
        return "monthly-amount";
    }
    if (rule.dailyCountCap && facts.paidTodayCount + facts.openCount + 1 > rule.dailyCountCap)
        return "daily-count";
    return null;
}
export function stateReject(input) {
    const { rule, facts, now } = input;
    const paused = rule.pausedUntil === undefined ? null : Date.parse(rule.pausedUntil);
    if (paused !== null && (!Number.isFinite(paused) || paused > now.getTime()))
        return "paused";
    if (facts.blockedUntil && facts.blockedUntil > now)
        return "circuit-open";
    if (rule.noSplit && input.isSplit)
        return "split";
    if (rule.sites && rule.sites.length > 0 && !rule.sites.includes(input.appId))
        return "site";
    if (input.scene && rule.scenes && rule.scenes.length > 0 && !rule.scenes.includes(input.scene))
        return "scene";
    return null;
}
function amountReject({ rule, amountCents }) {
    if (rule.amountMinCents && amountCents < BigInt(rule.amountMinCents))
        return "amount";
    if (rule.amountMaxCents && amountCents > BigInt(rule.amountMaxCents))
        return "amount";
    const fixed = rule.fixedAmountsCents ?? [];
    if (fixed.length > 0 && !fixed.some((c) => BigInt(c) === amountCents))
        return "amount";
    return null;
}
function intervalReject({ rule, facts, now, continuation }) {
    if (!rule.minIntervalSec || !facts.lastPickedAt || continuation)
        return null;
    return now.getTime() - facts.lastPickedAt.getTime() < rule.minIntervalSec * 1000 ? "min-interval" : null;
}
/** Can this channel take this payment now? Caps include the current payment ("adding this one exceeds"). */
export function checkRule(input) {
    if (!inTimeWindows(input.rule.timeWindows, input.now))
        return stateReject(input) ?? amountReject(input) ?? "time-window";
    return stateReject(input) ?? amountReject(input) ?? capReject(input) ?? intervalReject(input);
}
/** Lowest priority tier first; inside the tier weighted random (`random` injectable for tests). */
export function pickCandidate(candidates, random) {
    const usable = candidates.filter((c) => c.weight > 0);
    if (usable.length === 0)
        return null;
    const best = Math.min(...usable.map((c) => c.priority));
    const tier = usable.filter((c) => c.priority === best);
    const total = tier.reduce((sum, c) => sum + c.weight, 0);
    let roll = random() * total;
    for (const c of tier) {
        roll -= c.weight;
        if (roll < 0)
            return c;
    }
    return tier[tier.length - 1] ?? null;
}
/** Circuit breaker: after `threshold` consecutive create failures block for `cooldownSec`. */
export function breakerAfterFailure(consecutiveFailures, rule, now) {
    const failures = consecutiveFailures + 1;
    const threshold = rule.failureThreshold ?? 5;
    if (failures < threshold)
        return { failures, blockedUntil: null };
    return { failures, blockedUntil: new Date(now.getTime() + (rule.failureCooldownSec ?? 300) * 1000) };
}
