import type { StandaloneStore } from "./types.ts";
/**
 * Standalone background jobs (one timer, unref'd):
 * - sweeper: pending orders past expiry → expired, their open attempts closed (every `sweepEveryMs`, default 30 s);
 * - retention: events and failed / closed attempts older than `retentionDays` (default 35, owner 11-03) are pruned
 *   in batches once an hour. Orders, payments and channel revenue are money records and are never pruned here.
 * Safe on several instances (pg: `FOR UPDATE SKIP LOCKED`; deletes are idempotent).
 */
export interface StandaloneJobOptions {
    sweepEveryMs?: number;
    retentionDays?: number;
    batch?: number;
    now?: () => Date;
    onError?: (job: "sweep" | "retention", e: unknown) => void;
}
/** One round (also the unit tests' entry): sweep all due orders, then prune when `prune` is set. */
export declare function runStandaloneMaintenance(store: StandaloneStore, opts?: StandaloneJobOptions & {
    prune?: boolean;
}): Promise<{
    expired: number;
    pruned: number;
}>;
export declare function startStandaloneJobs(store: StandaloneStore, opts?: StandaloneJobOptions): {
    stop(): void;
};