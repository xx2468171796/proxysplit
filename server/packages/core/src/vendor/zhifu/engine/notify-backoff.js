/** Outbox retry schedule: 5s, 30s, 2m, 10m, 30m, 1h, 2h, 4h, 8h, then every 8h until 72h since creation → dead. */
export const BACKOFF_SEC = [5, 30, 120, 600, 1800, 3600, 7200, 14400, 28800];
export const MAX_AGE_SEC = 72 * 3600;
export function nextDelaySec(attemptsDone) {
    const i = Math.max(0, attemptsDone - 1);
    return BACKOFF_SEC[Math.min(i, BACKOFF_SEC.length - 1)] ?? 28800;
}
/** After a failed attempt: when to try again, or null = give up (dead). */
export function nextAttemptAt(createdAt, attemptsDone, now) {
    const next = new Date(now.getTime() + nextDelaySec(attemptsDone) * 1000);
    return next.getTime() - createdAt.getTime() > MAX_AGE_SEC * 1000 ? null : next;
}
/** Only HTTP 2xx with JSON `{ "code": 0 }` is an ack. */
export function isAck(status, body) {
    if (status < 200 || status >= 300)
        return false;
    try {
        const parsed = JSON.parse(body);
        return typeof parsed === "object" && parsed !== null && "code" in parsed && parsed.code === 0;
    }
    catch {
        return false;
    }
}
/** Status after one delivery. Manual re-pushes never advance the schedule; test rows never retry. */
export function statusAfterDelivery(input) {
    if (input.ack)
        return "acked";
    if (input.event === "test")
        return "dead";
    if (input.manual)
        return input.current;
    return input.next ? "pending" : "dead";
}
