import type { PayLinkKind, PayScene } from "../presentation/index.ts";
/** The one interface every upstream channel module implements. Amounts are integer cents. */
export declare const CHANNEL_KINDS: readonly ["zhongzhuan", "mock", "alipay", "shouqianba", "paofen", "sms", "aggregator"];
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export interface CreateInput {
    attemptNo: string;
    amountCents: bigint;
    subject: string;
    notifyUrl: string;
    returnUrl: string | null;
    line: string | null;
    isSplit: boolean;
    /** Real payer IP (Alipay scan IP first; public addresses only, never 127.0.0.1); null = unknown. */
    clientIp: string | null;
    /** Upstream order expiry aligned to our QR TTL (hand-off standard §3.5.8). */
    expiresAt: Date;
    /** Payer scene (`zhifu/presentation` detectPayScene, decided at order creation); missing = unknown. */
    scene?: PayScene;
    /**
     * Link kind the presentation policy wants (`wantLink`); null / missing = the adapter's default. An adapter that
     * declares this kind in `links` must return it (or fail), never something else under that name.
     */
    wantLink?: PayLinkKind | null;
}
/**
 * What an adapter does with the hand-off fields its upstream API may or may not have (hand-off standard,
 * architecture §3.5.8). Every adapter declares it; the contract suite (`zhifu/handoff` `checkHandoffWire`) checks the
 * declared "sent" fields really reach the wire and nothing else leaks.
 */
export interface HandoffSupport {
    /** "sent" = `CreateInput.clientIp` goes upstream; "unsupported" = the upstream API has no such field. */
    clientIp: "sent" | "unsupported";
    /** "sent" = `CreateInput.expiresAt` goes upstream; "unsupported" = no expiry field. */
    expiry: "sent" | "unsupported";
    /** "sent" = `CreateInput.returnUrl` (center-only) goes upstream when set; "never" = not sent at all. */
    returnUrl: "sent" | "never";
}
export interface CreateResult {
    ok: boolean;
    error?: string;
    channelOrderNo?: string;
    payUrl?: string;
    checkoutUrl?: string;
    payTip?: string;
    expiresAt?: Date;
    line?: string;
    lineHonored?: boolean;
    /** Pay method label the upstream opened (「支付宝 H5」); stored on the attempt for 查账 通道 / 方式. */
    payway?: string;
    /** Kind of `payUrl` (must be one of the adapter's `links`; `alipay_qr` = official Alipay https link; `wx_qr` = official WeChat Pay link). */
    linkKind?: PayLinkKind;
}
export type UpstreamStatus = "pending" | "paid" | "expired" | "cancelled";
export interface QueryResult {
    status: UpstreamStatus;
    amountCents: bigint;
    upstreamTradeNo?: string;
    channelOrderNo?: string;
    payerInfo?: string;
    paidAt?: Date;
    raw?: Record<string, unknown>;
}
/** A verified callback. kind=paid carries the money fact; anything else is acknowledged and ignored. */
export type CallbackFact = {
    kind: "paid";
    attemptNo: string;
    amountCents: bigint;
    upstreamTradeNo: string | null;
    payerInfo: string | null;
    paidAt: Date;
    raw: Record<string, unknown>;
}
/** Async refund result for an earlier `pending` refund of this attempt. */
 | {
    kind: "refund";
    attemptNo: string;
    succeeded: boolean;
    error: string | null;
} | {
    kind: "other";
    attemptNo: string | null;
};
export interface CallbackInput {
    body: string;
    headers: Readonly<Record<string, string | undefined>>;
}
export interface RefundInput {
    attemptNo: string;
    refundNo: string;
    amountCents: bigint;
    reason: string | null;
    /** What the attempt itself collected (full-refund-only channels compare against it); null = unknown. */
    attemptCents: bigint | null;
}
export interface RefundResult {
    status: "succeeded" | "pending" | "failed" | "unsupported";
    error?: string;
}
export interface PayLine {
    id: string;
    name: string;
    usable: boolean;
    reason: string | null;
    recommended: boolean;
}
export interface StatementLine {
    attemptNo: string;
    upstreamTradeNo: string | null;
    amountCents: bigint;
    paidAt: Date;
}
export interface ChannelAdapter {
    readonly kind: ChannelKind;
    /** What callers should answer the upstream after handling a callback. */
    readonly callbackAck: string;
    /** Hand-off standard declaration (required: a new adapter must say what it sends). */
    readonly handoff: HandoffSupport;
    /**
     * Pay-presentation capability (`zhifu/presentation`): link kinds `create` can return; the first is the default.
     * Optional for older project-local adapters (treated as ["h5"]); built-in adapters all declare it.
     */
    readonly links?: readonly PayLinkKind[];
    create(input: CreateInput): Promise<CreateResult>;
    /** null = unknown / unreachable (never guess). */
    query(attemptNo: string): Promise<QueryResult | null>;
    /** null = signature invalid / unparsable. */
    verifyCallback(input: CallbackInput): Promise<CallbackFact | null>;
    /** Best-effort upstream close (true = closed or never existed). Not called by the core yet: upstream expiry
     * (`time_expire` = our QR TTL) closes unpaid trades on its own, and late money still settles. */
    close?(attemptNo: string): Promise<boolean>;
    refund?(input: RefundInput): Promise<RefundResult>;
    /** Status of an earlier refund; null = unknown / unreachable. Used by the stuck-refund sweep. */
    queryRefund?(input: RefundInput): Promise<RefundResult | null>;
    listLines?(amountCents: bigint): Promise<PayLine[]>;
    fetchStatement?(day: string): Promise<StatementLine[] | null>;
}
/** Builds an adapter for a configured channel row (credentials already decrypted). */
export type ChannelFactory = (config: {
    code: string;
    credentials: Record<string, unknown>;
    /** 中转站 channel id to pin (zhongzhuan only); null / missing = gateway routes. */
    gatewayChannelId?: number | null;
}) => ChannelAdapter;