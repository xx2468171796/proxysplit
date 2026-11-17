/** Outbox retry schedule: 5s, 30s, 2m, 10m, 30m, 1h, 2h, 4h, 8h, then every 8h until 72h since creation → dead. */
export declare const BACKOFF_SEC: readonly [5, 30, 120, 600, 1800, 3600, 7200, 14400, 28800];
export declare const MAX_AGE_SEC: number;
export declare function nextDelaySec(attemptsDone: number): number;
/** After a failed attempt: when to try again, or null = give up (dead). */
export declare function nextAttemptAt(createdAt: Date, attemptsDone: number, now: Date): Date | null;
/** Only HTTP 2xx with JSON `{ "code": 0 }` is an ack. */
export declare function isAck(status: number, body: string): boolean;
export type OutboxStatus = "pending" | "acked" | "dead";
/** Status after one delivery. Manual re-pushes never advance the schedule; test rows never retry. */
export declare function statusAfterDelivery(input: {
    ack: boolean;
    event: string;
    manual: boolean;
    current: OutboxStatus;
    next: Date | null;
}): OutboxStatus;