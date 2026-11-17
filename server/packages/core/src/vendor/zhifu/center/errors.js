/**
 * Stable error codes returned by the service as `{ code, message, traceId }` (contract-tested against the
 * server's ERROR_CODES). Branch on `code`, show `message` to the player.
 */
export const PAY_ERROR_CODES = [
    "BAD_REQUEST",
    "SIGN_INVALID",
    "TIMESTAMP_SKEW",
    "NONCE_REPLAY",
    "APP_UNKNOWN",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "SITE_DISABLED",
    "COLLECTION_OFF",
    "NOT_FOUND",
    "IDEMPOTENCY_CONFLICT",
    "STATE_CONFLICT",
    "COOLDOWN",
    "PAY_BANNED",
    "QUEUE_FULL",
    "QUEUED",
    "CHALLENGE_REQUIRED",
    "RATE_LIMITED",
    "AMOUNT_INVALID",
    "SPLIT_TOO_LARGE",
    "NO_CHANNEL",
    /** 5.4 通道异常：本站没有任何可用通道（全部暂停 / 熔断 / 关闭）。details.ui = kind "outage"；不排队、不出码、不计任何次数。 */
    "PAY_OUTAGE",
    "CHANNEL_FAILED",
    "CHANNEL_NOT_IMPLEMENTED",
    "INTERNAL",
    /** 4.6: the player already has an open order (details: order_no, site_order_no, amount_cents, same_site, site_name, expires_at). */
    "OPEN_ORDER_EXISTS",
    /** 4.6: account trust gate (bind a phone first / account too new). */
    "TRUST_REQUIRED",
];
/** Codes the player can resolve by waiting (show the message, keep the dialog). */
export const PLAYER_WAIT_CODES = ["COOLDOWN", "QUEUE_FULL", "RATE_LIMITED"];
/** Error returned by the service. `details` carries e.g. `retry_after_sec`, `queue_full`, `pay_banned`. */
export class PayServiceError extends Error {
    constructor(code, message, status, extra = {}) {
        super(message);
        this.name = "PayServiceError";
        this.code = code;
        this.status = status;
        this.traceId = typeof extra.traceId === "string" ? extra.traceId : undefined;
        this.details = extra;
    }
    /** Safe to retry the same call (idempotency key / ref unchanged). */
    get retryable() {
        return this.code === "NETWORK" || this.code === "TIMEOUT" || this.status >= 500 || this.code === "RATE_LIMITED";
    }
}
export function isPayServiceError(e) {
    return e instanceof PayServiceError;
}
function asCode(v) {
    return typeof v === "string" && PAY_ERROR_CODES.includes(v) ? v : "HTTP";
}
export function errorFromBody(data, status, statusText) {
    const { code, message, ...extra } = data;
    return new PayServiceError(asCode(code), typeof message === "string" ? message : statusText, status, extra);
}
export async function settle(p) {
    try {
        return { ok: true, value: await p };
    }
    catch (e) {
        if (isPayServiceError(e))
            return { ok: false, error: e };
        throw e;
    }
}
