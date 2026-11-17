import type { AmountRoute, RoutingMode } from "./schema.ts";
import { type Candidate } from "./rules.ts";
/** Codes allowed for this amount by the first matching amount route; null = no route matched (all allowed). */
export declare function amountRouteCodes(routes: readonly AmountRoute[], amountCents: bigint): string[] | null;
/** The amount routes that apply to a site: its own (even an empty list = unrestricted) else the global ones. Pure. */
export declare function effectiveAmountRoutes(site: readonly AmountRoute[] | null | undefined, global: readonly AmountRoute[]): readonly AmountRoute[];
/**
 * Rotation cursor key: one cursor per (site, mode, candidate set), so each site rotates independently and a
 * change in the usable set (a channel paused / capped) starts a fresh rotation instead of skewing an old one.
 */
export declare function cursorKey(appId: string, mode: RoutingMode, codes: readonly string[]): string;
/** Modes that rotate through a cursor (one atomic counter per cursor key, safe across api instances). */
export declare function needsCursor(mode: RoutingMode): boolean;
/** Smooth weighted round robin (nginx): A:3 B:1 → A A B A, spread out instead of bursts. Pure. */
export declare function smoothWeightedSequence(list: readonly Candidate[]): Candidate[];
export interface PickOptions {
    random: () => number;
    /** Monotonic counter for the rotating modes (ignored by the others). */
    cursor: bigint;
}
/**
 * Choose among channels that already passed their own rules. Weight 0 = never picked automatically
 * (in every mode), so staff can park a channel without disabling it.
 */
export declare function pickByMode(mode: RoutingMode, candidates: readonly Candidate[], o: PickOptions): Candidate | null;