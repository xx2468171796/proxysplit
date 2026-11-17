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
export declare const SIGNALS_VERSION = 1;
export declare const SIGNALS_EXT_MAX_KEYS = 32;
export declare const SIGNALS_MAX_BYTES = 4096;
/** Known signals (all optional). Add new typed keys here; until then sites send them under `ext`. */
export declare const paySignalsSchema: z.ZodObject<{
    v: z.ZodDefault<z.ZodLiteral<1>>;
    riskScore: z.ZodOptional<z.ZodNumber>;
    accountFlags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    kycLevel: z.ZodOptional<z.ZodNumber>;
    recentPayFails24h: z.ZodOptional<z.ZodNumber>;
    recentLogins24h: z.ZodOptional<z.ZodNumber>;
    campaign: z.ZodOptional<z.ZodString>;
    referralRef: z.ZodOptional<z.ZodString>;
    ext: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
}, z.core.$strict>;
export type PaySignals = z.infer<typeof paySignalsSchema>;
/** Reads one signal by name: a known key first, then `ext[name]`. Scalars only (arrays → joined membership test). */
export declare function signalValue(s: PaySignals | null | undefined, name: string): string | number | boolean | null;
/**
 * Site → center: full payer + risk context (server-side facts; never trust the browser for these).
 * `deviceFp` = the request's `x-device-fingerprint` header, `clientIp` = the trusted `req.ip`.
 */
export declare const payCreateRequestSchema: z.ZodObject<{
    siteOrderNo: z.ZodString;
    idempotencyKey: z.ZodString;
    amountCents: z.ZodNumber;
    subject: z.ZodDefault<z.ZodString>;
    userRef: z.ZodString;
    payerUsername: z.ZodOptional<z.ZodString>;
    payerNickname: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
    huiyuanId: z.ZodOptional<z.ZodString>;
    accountCreatedAt: z.ZodOptional<z.ZodString>;
    phoneVerified: z.ZodOptional<z.ZodBoolean>;
    sessionId: z.ZodOptional<z.ZodString>;
    deviceFp: z.ZodOptional<z.ZodString>;
    clientIp: z.ZodOptional<z.ZodString>;
    userAgent: z.ZodOptional<z.ZodString>;
    touchHint: z.ZodOptional<z.ZodBoolean>;
    vipLevel: z.ZodOptional<z.ZodNumber>;
    playerLevel: z.ZodOptional<z.ZodNumber>;
    totalRechargedCents: z.ZodOptional<z.ZodNumber>;
    onOpen: z.ZodOptional<z.ZodEnum<{
        cancel: "cancel";
        ask: "ask";
    }>>;
    challengePassed: z.ZodOptional<z.ZodBoolean>;
    signals: z.ZodOptional<z.ZodObject<{
        v: z.ZodDefault<z.ZodLiteral<1>>;
        riskScore: z.ZodOptional<z.ZodNumber>;
        accountFlags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        kycLevel: z.ZodOptional<z.ZodNumber>;
        recentPayFails24h: z.ZodOptional<z.ZodNumber>;
        recentLogins24h: z.ZodOptional<z.ZodNumber>;
        campaign: z.ZodOptional<z.ZodString>;
        referralRef: z.ZodOptional<z.ZodString>;
        ext: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type PayCreateRequest = z.input<typeof payCreateRequestSchema>;
/** Browser → site `POST /api/pay/create`. The site adds every payer fact itself. */
/** 6.7 `PayStartBody.extra`: ≤ 16 scalar keys (string ≤ 128 / finite number / boolean), same key pattern as `signals.ext`. */
export declare const PAY_START_EXTRA_MAX_KEYS = 16;
export declare const payStartExtraSchema: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
export type PayStartExtra = z.infer<typeof payStartExtraSchema>;
export declare const payStartBodySchema: z.ZodObject<{
    amountCents: z.ZodNumber;
    requestId: z.ZodString;
    hvToken: z.ZodOptional<z.ZodString>;
    touchHint: z.ZodOptional<z.ZodBoolean>;
    onOpen: z.ZodOptional<z.ZodEnum<{
        cancel: "cancel";
        ask: "ask";
    }>>;
    extra: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
}, z.core.$strict>;
export type PayStartBody = z.infer<typeof payStartBodySchema>;
export type PayScene = "desktop" | "mobile" | "tablet" | "unknown";
export type RefuseReason = "cooldown" | "banned" | "trust" | "risk" | "outage" | "off" | "busy" | "amount" | "error";
export interface PayStartOrder {
    kind: "order";
    orderNo: string;
    /** Order-bound token for the center's overlay endpoints (~10 min, refreshed by every overlay read). */
    orderToken: string;
    /** Center base URL the overlay talks to (status / check / resume). */
    centerUrl: string;
    amountCents: number;
    status: "pending" | "partial" | "paid" | "expired" | "cancelled";
    expiresAt: string;
    payUrl: string | null;
    payExpiresAt: string | null;
    linkKind: "h5" | "alipay_qr" | "page" | "wx_qr" | "wx_h5" | null;
    jumpHint: string | null;
    scene: PayScene;
}
/** Site → browser answer of `POST /api/pay/create`. */
export type PayStartResult = PayStartOrder | {
    kind: "queued";
    ahead: number;
    etaMs: number;
    pollMs: number;
    text: string;
} | {
    kind: "challenge";
    message: string;
} | {
    kind: "open_order";
    message: string;
    amountCents: number | null;
    sameSite: boolean;
} | {
    kind: "refused";
    reason: RefuseReason;
    title: string;
    message: string;
    retryAfterSec: number | null;
};
/** Center → browser (overlay endpoints, token-scoped). Minimal: no player data. */
export interface OverlayOrderView {
    order_no: string;
    status: "pending" | "partial" | "paid" | "expired" | "cancelled";
    amount_cents: number;
    paid_cents: number;
    expires_at: string;
    pay: {
        url: string;
        link_kind: "h5" | "alipay_qr" | "page" | "wx_qr" | "wx_h5" | null;
        jump_hint: string | null;
        expires_at: string;
    } | null;
    scene: PayScene;
    /** QR re-pulls left in the current window (null = unlimited / unknown). */
    repull_left: number | null;
    repull_window_min: number | null;
    /** Fresh token (the overlay swaps it in; the old one keeps working until it expires). */
    token: string;
    copy: {
        confirming?: string | null;
    } | null;
    /** Set when the site went into outage while the order was open. */
    outage?: boolean;
    /** 6.5.2: the site acked the order.paid notify (= credited on the site). Absent on older centers. */
    site_acked?: boolean;
    /**
     * 6.16 split payment: present when the order has ≥ 2 pieces. `seq` = the piece the current code is for (the first
     * unpaid one), `amount_cents` = that piece's amount. Absent / null = single payment (older centers too).
     */
    pieces?: {
        count: number;
        seq: number;
        amount_cents: number;
    } | null;
}
export declare const OVERLAY_TOKEN_TTL_SEC = 600;