/**
 * `zhifu/contracts` — the unified pay overlay contracts (6.5, owner 11-05 「统一付款浮层」).
 *
 * Three hops, three shapes:
 *   browser  → site     `PayStartBody`      what the page may say (amount + its own request id + slider token)
 *   site     → center   `PayCreateRequest`  everything the site knows about the payer (server-side facts only)
 *   site     → browser  `PayStartResult`    order + order-bound token, or queued / refused (no PII)
 *   center   → browser  `OverlayOrderView`  status / QR link / countdown for one order (token-scoped)
 *
 * `signals` is the extension point for future decision data (risk, account flags, campaign, KYC …): known keys are
 * typed, anything else goes under `signals.ext` (scalar values, size-limited). The center stores the object with the
 * order and the risk engine reads it by name (`zhifu/risk` signal rules) — adding a signal = the site sends it.
 */
import { z } from "zod";
/** Signal contract version; bump only on a breaking change of the known keys. */
export const SIGNALS_VERSION = 1;
export const SIGNALS_EXT_MAX_KEYS = 32;
export const SIGNALS_MAX_BYTES = 4096;
const SIGNAL_KEY = /^[a-z][A-Za-z0-9_]{0,39}$/;
const extValue = z.union([z.string().max(128), z.number().finite(), z.boolean()]);
/** Known signals (all optional). Add new typed keys here; until then sites send them under `ext`. */
export const paySignalsSchema = z
    .object({
    v: z.literal(SIGNALS_VERSION).default(SIGNALS_VERSION),
    /** Site-side risk score 0–100 (higher = riskier). */
    riskScore: z.number().int().min(0).max(100).optional(),
    /** Account flags, e.g. ["new_device", "chargeback_history"]. */
    accountFlags: z.array(z.string().regex(SIGNAL_KEY)).max(16).optional(),
    /** KYC / real-name level (0 = none). */
    kycLevel: z.number().int().min(0).max(9).optional(),
    /** Failed / abandoned pays in the last 24 h on this site. */
    recentPayFails24h: z.number().int().min(0).max(100000).optional(),
    /** Logins in the last 24 h. */
    recentLogins24h: z.number().int().min(0).max(100000).optional(),
    /** Campaign / channel tag the player came from. */
    campaign: z.string().max(64).optional(),
    /** Inviter / referral reference (opaque id, not PII). */
    referralRef: z.string().max(64).optional(),
    /** Anything else: scalar values only, ≤ 32 keys. */
    ext: z
        .record(z.string().regex(SIGNAL_KEY), extValue)
        .refine((o) => Object.keys(o).length <= SIGNALS_EXT_MAX_KEYS, `signals.ext 最多 ${SIGNALS_EXT_MAX_KEYS} 个键`)
        .optional(),
})
    .strict()
    .refine((o) => JSON.stringify(o).length <= SIGNALS_MAX_BYTES, `signals 不超过 ${SIGNALS_MAX_BYTES} 字节`);
/** Reads one signal by name: a known key first, then `ext[name]`. Scalars only (arrays → joined membership test). */
export function signalValue(s, name) {
    if (!s)
        return null;
    const known = s[name];
    if (name !== "ext" && (typeof known === "string" || typeof known === "number" || typeof known === "boolean"))
        return known;
    const ext = s.ext?.[name];
    return ext === undefined ? null : ext;
}
/**
 * Site → center: full payer + risk context (server-side facts; never trust the browser for these).
 * `deviceFp` = the request's `x-device-fingerprint` header, `clientIp` = the trusted `req.ip`.
 */
export const payCreateRequestSchema = z
    .object({
    siteOrderNo: z.string().min(1).max(64),
    idempotencyKey: z.string().min(1).max(128),
    amountCents: z.number().int().positive().max(100000000),
    subject: z.string().min(1).max(64).default("充值"),
    userRef: z.string().min(1).max(64),
    payerUsername: z.string().max(64).optional(),
    payerNickname: z.string().max(64).optional(),
    phone: z.string().max(32).optional(),
    huiyuanId: z.string().max(64).optional(),
    accountCreatedAt: z.string().datetime({ offset: true }).optional(),
    phoneVerified: z.boolean().optional(),
    sessionId: z.string().max(128).optional(),
    deviceFp: z.string().max(128).optional(),
    clientIp: z.string().max(64).optional(),
    userAgent: z.string().max(512).optional(),
    touchHint: z.boolean().optional(),
    vipLevel: z.number().int().min(0).max(1000).optional(),
    playerLevel: z.number().int().min(0).max(100000).optional(),
    totalRechargedCents: z.number().int().min(0).max(1e13).optional(),
    onOpen: z.enum(["ask", "cancel"]).optional(),
    challengePassed: z.boolean().optional(),
    signals: paySignalsSchema.optional(),
})
    .strict();
/** Browser → site `POST /api/pay/create`. The site adds every payer fact itself. */
/** 6.7 `PayStartBody.extra`: ≤ 16 scalar keys (string ≤ 128 / finite number / boolean), same key pattern as `signals.ext`. */
export const PAY_START_EXTRA_MAX_KEYS = 16;
export const payStartExtraSchema = z
    .record(z.string().regex(/^[a-z][A-Za-z0-9_]{0,39}$/), z.union([z.string().max(128), z.number().finite(), z.boolean()]))
    .refine((o) => Object.keys(o).length <= PAY_START_EXTRA_MAX_KEYS, { message: "too many extra keys" });
export const payStartBodySchema = z
    .object({
    amountCents: z.number().int().positive().max(100000000),
    /** The overlay's own id for this pay attempt: same id = same order (queue retries, double taps). */
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    /** One-time central slider token (LcVerify, action "pay") after a `challenge` answer. */
    hvToken: z.string().min(1).max(512).optional(),
    touchHint: z.boolean().optional(),
    /** The player chose 「取消旧订单并继续」 after `open_order`. */
    onOpen: z.enum(["ask", "cancel"]).optional(),
    /**
     * 6.7: the site page's own order choice (plan id, coupon id …), forwarded verbatim by `pay({ extra })`.
     * Browser input: the site route MUST validate and authorize every key itself (coupon owned by the player, plan exists …).
     */
    extra: payStartExtraSchema.optional(),
})
    .strict();
export const OVERLAY_TOKEN_TTL_SEC = 600;
