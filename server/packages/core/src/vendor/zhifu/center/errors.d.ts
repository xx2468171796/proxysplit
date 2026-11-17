/**
 * Stable error codes returned by the service as `{ code, message, traceId }` (contract-tested against the
 * server's ERROR_CODES). Branch on `code`, show `message` to the player.
 */
export declare const PAY_ERROR_CODES: readonly ["BAD_REQUEST", "SIGN_INVALID", "TIMESTAMP_SKEW", "NONCE_REPLAY", "APP_UNKNOWN", "UNAUTHORIZED", "FORBIDDEN", "SITE_DISABLED", "COLLECTION_OFF", "NOT_FOUND", "IDEMPOTENCY_CONFLICT", "STATE_CONFLICT", "COOLDOWN", "PAY_BANNED", "QUEUE_FULL", "QUEUED", "CHALLENGE_REQUIRED", "RATE_LIMITED", "AMOUNT_INVALID", "SPLIT_TOO_LARGE", "NO_CHANNEL", "PAY_OUTAGE", "CHANNEL_FAILED", "CHANNEL_NOT_IMPLEMENTED", "INTERNAL", "OPEN_ORDER_EXISTS", "TRUST_REQUIRED"];
/** Server codes plus the SDK's own: HTTP (non-JSON reply), NETWORK (no reply), TIMEOUT. */
export type PayErrorCode = (typeof PAY_ERROR_CODES)[number] | "HTTP" | "NETWORK" | "TIMEOUT";
/** Codes the player can resolve by waiting (show the message, keep the dialog). */
export declare const PLAYER_WAIT_CODES: readonly PayErrorCode[];
/** Error returned by the service. `details` carries e.g. `retry_after_sec`, `queue_full`, `pay_banned`. */
export declare class PayServiceError extends Error {
    readonly code: PayErrorCode;
    readonly status: number;
    readonly traceId: string | undefined;
    readonly details: Readonly<Record<string, unknown>>;
    constructor(code: PayErrorCode, message: string, status: number, extra?: Record<string, unknown>);
    /** Safe to retry the same call (idempotency key / ref unchanged). */
    get retryable(): boolean;
}
export declare function isPayServiceError(e: unknown): e is PayServiceError;
export declare function errorFromBody(data: Record<string, unknown>, status: number, statusText: string): PayServiceError;
/** Result form for callers that prefer not to throw (e.g. createOrder → show COOLDOWN text). */
export type PayResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: PayServiceError;
};
export declare function settle<T>(p: Promise<T>): Promise<PayResult<T>>;