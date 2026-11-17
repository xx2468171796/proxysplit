import { type PayResult } from "./errors.ts";
import { type PayUi } from "./ui.ts";
export { PayServiceError } from "./errors.ts";
export interface PayClientOptions {
    appId: string;
    secret: string;
    /** e.g. https://pay.example.com */
    baseUrl: string;
    fetch?: typeof fetch;
    /** Per attempt, default 40 s (the service may hold a create in the global queue for up to 30 s). */
    timeoutMs?: number;
    /** 5.16 payStatus cache (default 5000 ms). */
    statusTtlMs?: number;
    /** Extra attempts on NETWORK / TIMEOUT / 5xx / RATE_LIMITED, default 2 (every call is idempotent). */
    retries?: number;
    /** First backoff, doubled per retry with jitter; default 300 ms. */
    backoffMs?: number;
}
export interface Player {
    /** The player's id on this site (required). */
    siteUserRef: string;
    /** 会员中心 account id — preferred cross-site identity for the order cooldown. */
    huiyuanId?: string;
    /**
     * Phone number: the cross-site cooldown key when there is no huiyuanId (hashed), and since 4.14 also kept on the
     * order for the payment-center admin (shown masked, full number only via an audited reveal).
     */
    phone?: string;
    /** 4.14 payer profile for the payment-center admin (收款明细 / 订单: 昵称 · 用户名, fuzzy search). Optional. */
    username?: string;
    nickname?: string;
}
export interface CreateOrderInput {
    siteOrderNo: string;
    /** Same key → same order (safe to retry). Defaults to siteOrderNo. */
    idempotencyKey?: string;
    player: Player;
    amountCents: number;
    subject: string;
    clientIp?: string;
    line?: string;
    returnUrl?: string;
    /** 4.6: yanzheng device fingerprint (`x-device-fingerprint` header of the player's request); hashed by the service. */
    deviceFingerprint?: string;
    /** 4.6: seconds since the player's account was created (trust gate «account age»). */
    accountAgeSec?: number;
    /**
     * 4.6: what to do when the player already has an open order. "ask" (default): same site + same amount →
     * the open order comes back (`reused: true`, fresh QR if it expired); otherwise OPEN_ORDER_EXISTS.
     * "cancel": cancel the open order (the player chose 「取消后重新下单」) and create this one.
     */
    onOpen?: "ask" | "cancel";
    /** 4.7 full player context (sent once; every server rule reads it): browser user agent. */
    userAgent?: string;
    /** 6.2 client hint: the page saw `navigator.maxTouchPoints > 1` (iPad reporting a Mac UA → tablet scene). */
    touchHint?: boolean;
    /** 4.7: when the account was created (ISO); preferred over accountAgeSec. */
    accountCreatedAt?: string;
    /** 4.7: the site verified this phone by SMS. */
    phoneVerified?: boolean;
    /** 4.10: this player just passed the site's own slider (answer to CHALLENGE_REQUIRED). */
    challengePassed?: boolean;
    /** 6.5: the player's login session id on the site (opaque; groups orders of one session). */
    sessionId?: string;
    /** 6.5: VIP / player level and lifetime recharge on this site (risk + admin display). */
    vipLevel?: number;
    playerLevel?: number;
    totalRechargedCents?: number;
    /** 6.5 extensible decision data (`zhifu/contracts` paySignalsSchema); sent as one JSON field, stored with the order. */
    signals?: Record<string, unknown>;
}
export type OrderRef = {
    orderNo: string;
} | {
    siteOrderNo: string;
};
export interface PayInfo {
    attempt_no: string;
    channel: string;
    pay_url: string;
    checkout_url: string | null;
    pay_tip: string | null;
    expires_at: string;
    line: string | null;
    line_honored: boolean;
    /** 6.2 presentation (zhifu/presentation): kind of pay_url (h5 / alipay_qr / page / wx_qr); older centers omit it. */
    link_kind?: "h5" | "alipay_qr" | "page" | "wx_qr" | "wx_h5" | null;
    /** 6.2: the line under the phone jump button (center config: site > channel > default); older centers omit it. */
    jump_hint?: string | null;
}
export interface OrderView {
    order_no: string;
    site_order_no: string;
    status: "pending" | "partial" | "paid" | "expired" | "cancelled";
    amount_cents: number;
    paid_cents: number;
    refunded_cents: number;
    late: boolean;
    expires_at: string;
    paid_at: string | null;
    pieces: {
        seq: number;
        amount_cents: number;
        status: string;
    }[];
    current: PayInfo | null;
    next_order_tip: string | null;
    session_token: string | null;
    /** How long this create waited in the global queue (ms). */
    queued_ms: number;
    queue_full: boolean;
    pay_banned: boolean;
    /** 4.6: create returned the player's existing open order instead of a new one. */
    reused?: boolean;
    /** 4.6: numbers for 「未支付将计入未付次数…」 (create / resume only). */
    unpaid?: {
        today: number;
        streak: number;
        next_wait_sec: number;
        left_before_ban: number;
    } | null;
    /** 4.7 server-driven prompt; render it with the site's one generic renderer (center/ui.ts). */
    ui?: PayUi | null;
    /** 5.4: the site has no live channel right now — `ui` is kind "outage"; close QR / countdown and show it. */
    outage?: boolean;
    /** 6.5 order-bound token for the pay overlay's center calls (~10 min); older centers omit it. */
    overlay_token?: string | null;
    /** 6.5 the payer's scene as the center decided it (UA + touch hint). */
    pay_scene?: "desktop" | "mobile" | "tablet" | "unknown" | null;
}
export interface QueuePollView {
    ready: boolean;
    position: number;
    eta_ms: number;
    text: string;
    /** 5.4: the site went into outage while queued — the player left the queue; show `ui` (kind "outage"). */
    outage?: boolean;
    ui?: PayUi | null;
}
/** 5.16 GET /v1/pay-status: is the site in 通道异常 right now (cheap public read, cached ~5 s). */
export interface PayStatusView {
    outage: boolean;
    /** kind "outage" with the owner's copy when `outage`, else null. */
    ui: PayUi | null;
}
/** GET /v1/pay-rules: current unpaid rules + the pre-pay dialog lines (zhifu payRulesLines) + queue status. */
export interface PayRulesView {
    rules: {
        enabled: boolean;
        baseIntervalSec: number;
        ladderSec: number[];
        banAfterUnpaid: number;
    };
    lines: string[];
    queue: {
        enabled: boolean;
        wait_ms: number;
        ahead: number;
        text: string;
    };
}
/** Thin signed client for the unified payment service (site backend → service). */
export declare function createPayClient(options: PayClientOptions): {
    /** Creates (or idempotently replays) an order. Throws PayServiceError: COOLDOWN / QUEUE_FULL / PAY_BANNED / … */
    createOrder: (input: CreateOrderInput) => Promise<OrderView>;
    /** Same as createOrder but never throws a service error: `{ ok, value } | { ok: false, error }`. */
    tryCreateOrder: (input: CreateOrderInput) => Promise<PayResult<OrderView>>;
    query: (ref: OrderRef) => Promise<OrderView>;
    cancel: (ref: OrderRef) => Promise<OrderView>;
    /** Resume (new QR for the same order) or switch line; never counts as a new order. */
    resume: (ref: OrderRef, line?: string) => Promise<OrderView>;
    /** 4.6 「我已支付」: asks the channel right now (rate-limited per order by the service), returns the order. */
    check: (ref: OrderRef) => Promise<OrderView>;
    lines: (amountCents: number) => Promise<{
        lines: PayLine[];
    }>;
    /**
     * 5.16 pay pre-check (unsigned, no rate-limit count): `{ outage, ui }`. Call it FIRST when the player clicks pay,
     * before 支付须知 / slider / queue (INTEGRATION §21.4). Cached ~5 s in-process; network error → open.
     */
    payStatus: () => Promise<PayStatusView>;
    /** Unsigned public read (rules + pre-pay dialog lines + queue); cache it a few seconds on the site. */
    payRules: () => Promise<PayRulesView>;
    /** 4.8 fair queue: the waiting player's place / ETA, `ready` = go create now (a pass is held for 20 s). */
    queuePoll: (player: CreateOrderInput["player"]) => Promise<QueuePollView>;
    /** Global queue status only (from payRules). */
    queue: () => Promise<{
        enabled: boolean;
        wait_ms: number;
        ahead: number;
        text: string;
    }>;
    refund: (input: {
        orderNo: string;
        refundNo: string;
        amountCents: number;
        reason?: string;
    }) => Promise<RefundView>;
};
export interface PayLine {
    id: string;
    name: string;
    usable: boolean;
    reason: string | null;
    recommended: boolean;
}
export interface RefundView {
    refund_no: string;
    status: "pending" | "succeeded" | "failed" | "manual";
    amount_cents: number;
}
export type PayClient = ReturnType<typeof createPayClient>;