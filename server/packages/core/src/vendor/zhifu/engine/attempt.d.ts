import type { ChannelAdapter, CreateResult } from "../channels/types.ts";
import { type HandoffSource } from "../handoff/index.ts";
/**
 * Opening an upstream attempt (both pay modes): pick a channel, reserve the attempt row BEFORE calling upstream
 * (a crash between "upstream created" and "stored" can never leave an unknown paid order), create only through
 * the hand-off standard, record the breaker outcome, store the result; on failure fail over to other channels
 * (first pick + at most 2 extra). A channel the player chose (`preferred`) is never swapped behind their back.
 */
export declare const MAX_ATTEMPT_TRIES = 3;
export type AttemptErrorCode = "CHANNEL_FAILED" | "NO_CHANNEL";
export declare class AttemptError extends Error {
    readonly code: AttemptErrorCode;
    constructor(code: AttemptErrorCode, message: string);
}
export interface AttemptPick {
    code: string;
    /** The player asked for this channel / line: no automatic failover. */
    preferred: boolean;
    adapter: ChannelAdapter;
}
export interface AttemptPort<P extends AttemptPick, R> {
    /** Next channel, never one in `exclude`; throws (host error) when none fits. */
    route(exclude: readonly string[]): Promise<P>;
    /** Claim the channel and write the attempt row in one transaction; null = no longer fits under the lock. */
    reserve(pick: P): Promise<R | null>;
    /** Everything the hand-off needs for this attempt (center base, payer IP, aligned expiry, site terms …). */
    handoffSource(pick: P, row: R): Promise<HandoffSource>;
    /** Breaker / health bookkeeping. */
    recordCreate(pick: P, ok: boolean, error: string | null): Promise<void>;
    /** ok + payUrl → stored row; otherwise mark the row failed and return null. */
    storeResult(row: R, pick: P, result: CreateResult): Promise<R | null>;
}
/** `first` = an attempt the caller already reserved in its own transaction. */
export declare function openAttemptWith<P extends AttemptPick, R>(port: AttemptPort<P, R>, first?: {
    pick: P;
    row: R | null;
}): Promise<R>;