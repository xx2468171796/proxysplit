import { z } from "zod";
/** Minute of the Beijing (UTC+8) day, 0–1439. */
export declare function beijingMinuteOfDay(at: Date): number;
/** A channel rule failed save-time validation; `field` names the bad field (hosts map it to a 400). */
export declare class ChannelRuleError extends Error {
    readonly field: string;
    constructor(message: string, field: string);
}
/**
 * Channel routing rules (ported from 中转站 `channel-rules.ts`, amounts converted to cents).
 * Save path = `strictChannelRule` (one bad field → field error). Runtime = `parseChannelRule`, tolerant per
 * field: a broken field drops only itself ("no limit"), except an unparsable pause, which counts as paused.
 */
export declare const channelRuleSchema: z.ZodObject<{
    sites: z.ZodOptional<z.ZodArray<z.ZodString>>;
    amountMinCents: z.ZodOptional<z.ZodNumber>;
    amountMaxCents: z.ZodOptional<z.ZodNumber>;
    fixedAmountsCents: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    dailyAmountCapCents: z.ZodOptional<z.ZodNumber>;
    monthlyAmountCapCents: z.ZodOptional<z.ZodNumber>;
    dailyCountCap: z.ZodOptional<z.ZodNumber>;
    minIntervalSec: z.ZodOptional<z.ZodNumber>;
    timeWindows: z.ZodOptional<z.ZodArray<z.ZodString>>;
    noSplit: z.ZodOptional<z.ZodBoolean>;
    failureThreshold: z.ZodOptional<z.ZodNumber>;
    failureCooldownSec: z.ZodOptional<z.ZodNumber>;
    qrTtlSec: z.ZodOptional<z.ZodNumber>;
    subjectFormat: z.ZodOptional<z.ZodEnum<{
        date5: "date5";
        catalog: "catalog";
    }>>;
    qrMode: z.ZodOptional<z.ZodEnum<{
        off: "off";
        desktop: "desktop";
        all: "all";
    }>>;
    jumpHint: z.ZodOptional<z.ZodString>;
    scenes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        desktop: "desktop";
        mobile: "mobile";
        tablet: "tablet";
        unknown: "unknown";
    }>>>;
    merchantBase: z.ZodOptional<z.ZodString>;
    pausedUntil: z.ZodOptional<z.ZodString>;
    pauseReason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ChannelRule = z.infer<typeof channelRuleSchema>;
/** Far-future pause used for "until resumed" and for a pause value that cannot be read. */
export declare const PAUSED_FOREVER = "2099-12-31T16:00:00.000Z";
/** Save-time validation: unknown keys or any invalid field → `ChannelRuleError` naming the field. */
export declare function strictChannelRule(raw: unknown): ChannelRule;
/** Runtime: field-by-field, so one dirty field never wipes the others (least of all the pause). */
export declare function parseChannelRule(raw: unknown): ChannelRule;
export interface ChannelFacts {
    paidTodayCents: bigint;
    paidTodayCount: number;
    paidMonthCents: bigint;
    lastPickedAt: Date | null;
    blockedUntil: Date | null;
    /** Open, unexpired attempts on this channel: money that may still arrive, so it counts toward the caps. */
    openCents: bigint;
    openCount: number;
}
/** Rules whose check depends on concurrent picks: routing takes the per-channel lock and re-checks. */
export declare function needsClaim(rule: ChannelRule): boolean;
export type RuleReject = "paused" | "circuit-open" | "split" | "site" | "amount" | "time-window" | "daily-amount" | "monthly-amount" | "daily-count" | "min-interval" | "scene";
export interface RuleInput {
    rule: ChannelRule;
    facts: ChannelFacts;
    appId: string;
    amountCents: bigint;
    isSplit: boolean;
    now: Date;
    /**
     * 6.16 piece 2..n of a split order the player is already paying: `minIntervalSec` (spacing between DIFFERENT
     * orders) does not apply; caps / windows / pause still do.
     */
    continuation?: boolean | undefined;
    /** 6.14 payer scene; missing = not checked (claim re-checks after routing already filtered by scene). */
    scene?: "desktop" | "mobile" | "tablet" | "unknown" | undefined;
}
/** Beijing-time windows "HH:mm-HH:mm", overnight allowed; empty = all day; unparsable entries ignored. */
export declare function inTimeWindows(windows: readonly string[] | undefined, now: Date): boolean;
export declare function capReject(input: RuleInput): RuleReject | null;
export declare function stateReject(input: RuleInput): RuleReject | null;
/** Can this channel take this payment now? Caps include the current payment ("adding this one exceeds"). */
export declare function checkRule(input: RuleInput): RuleReject | null;
export interface Candidate {
    code: string;
    priority: number;
    weight: number;
}
/** Lowest priority tier first; inside the tier weighted random (`random` injectable for tests). */
export declare function pickCandidate(candidates: readonly Candidate[], random: () => number): Candidate | null;
/** Circuit breaker: after `threshold` consecutive create failures block for `cooldownSec`. */
export declare function breakerAfterFailure(consecutiveFailures: number, rule: ChannelRule, now: Date): {
    failures: number;
    blockedUntil: Date | null;
};