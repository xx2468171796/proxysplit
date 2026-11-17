/** What the service POSTs to the site's notify url (flat, signed). */
export interface PaidNotification {
    app_id: string;
    /**
     * order.partial (4.4): a split order expired with only some pieces paid — informational; credit at most
     * paid_cents (if you credit per piece) and never the full amount. order.refunded may arrive once per refund
     * (refund_no / refund_amount_cents identify it).
     */
    event: NotifyEvent;
    notify_id: string;
    order_no: string;
    site_order_no: string;
    user_ref: string;
    amount_cents: number;
    paid_cents: number;
    refunded_cents: number;
    status: string;
    late: 0 | 1;
    paid_at: string;
    timestamp: number;
    nonce: string;
    sign: string;
    /** order.refunded only (zhifu-service ≥ 2026-11-01): this refund's number and amount. */
    refund_no?: string;
    refund_amount_cents?: number;
}
export type NotifyEvent = "order.paid" | "order.refunded" | "order.partial" | "test";
/**
 * Dedupe store. Production MUST back it with a DB unique key on notify_id (or your own fulfilment key) —
 * the in-memory default forgets on restart and is per process. Prefer `claim` (atomic insert-if-absent, e.g.
 * `insert … on conflict do nothing returning 1`): seen + mark is two steps, two concurrent retries can both pass.
 */
export interface DedupeStore {
    seen(notifyId: string): Promise<boolean>;
    mark(notifyId: string): Promise<void>;
    /** 4.4: atomically take the id; true = first time (go fulfil), false = already taken. */
    claim?(notifyId: string): Promise<boolean>;
    /** 4.4: give a claimed id back after the handler failed, so the retry runs it again. */
    release?(notifyId: string): Promise<void>;
}
export declare function memoryDedupe(max?: number): DedupeStore;
export interface NotifyHandlerOptions {
    appId: string;
    secret: string;
    /** Fulfil the order. Must be idempotent on order_no (the service retries until acked). */
    onPaid(n: PaidNotification): Promise<void>;
    onRefunded?(n: PaidNotification): Promise<void>;
    /** 4.4: split order expired partly paid. Informational — do not credit the full amount. */
    onPartial?(n: PaidNotification): Promise<void>;
    dedupe?: DedupeStore;
    maxSkewSec?: number;
}
export declare const ACK_BODY = "{\"code\":0}";
/**
 * Framework-agnostic handler: give it the raw body, return its { status, body } as the HTTP response.
 * Verifies the signature and timestamp, dedupes by notify_id, calls your handler, then acks.
 * Anything but `{"code":0}` with 2xx makes the service retry (backoff up to 72h).
 */
export declare function notifyHandler(options: NotifyHandlerOptions): (rawBody: string) => Promise<{
    status: number;
    body: string;
}>;