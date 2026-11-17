/**
 * Central pay config (owner 11-01): tiers, min / max amount, collection switch and the global queue / unpaid
 * rules are edited in zhifu-service and pulled by every site. Payments must never break because of this:
 * service → last good (memory) → snapshot file → the site's own local config, and `get()` never throws.
 */
export interface PayTier {
    amount_cents: number;
    label: string;
    bonus_cents: number;
    hot: boolean;
    enabled: boolean;
}
export interface PayConfig {
    app_id: string;
    version: number;
    tiers: {
        configured: boolean;
        allow_custom: boolean;
        items: PayTier[];
    };
    min_amount_cents: number;
    max_amount_cents: number;
    collection: {
        enabled: boolean;
        text: string;
    };
    /** Same JSON as `zhifu_gate:settings`; pass to `createGlobalPayControls({ settings })`. null = local fallback. */
    gate: Record<string, unknown> | null;
    rules_lines: string[];
    server_time: string;
    /** 6.4：中心可改的玩家文案（参数 copy.*）；老中心没有 = 用 PAY_COPY 默认 */
    copy?: {
        confirming?: string;
    };
    /** Where this value came from. */
    source: "service" | "snapshot" | "local";
    fetched_at: string;
}
/** The site's own config, used only when the service has never been reached. */
export interface LocalPayConfig {
    minAmountCents: number;
    maxAmountCents?: number;
    /** Amounts (cents) or full tiers. */
    tiers?: (number | Partial<PayTier>)[];
    allowCustom?: boolean;
}
export interface PayConfigSyncOptions {
    appId: string;
    secret: string;
    baseUrl: string;
    local: () => LocalPayConfig | Promise<LocalPayConfig>;
    /** Fresh for this long (default 30 s). */
    cacheMs?: number;
    /** After a failed pull, wait this long before trying again (default 10 s). */
    retryMs?: number;
    /** Last good config is written here (JSON) so a restart while the service is down keeps the central tiers. */
    snapshotFile?: string | null;
    fetch?: typeof fetch;
    timeoutMs?: number;
    /** 4.4：拒收没签名的响应（默认 false：没签名照收、只告警一次；带签名但不对的一律拒收）。 */
    requireSignature?: boolean;
    onLog?: (msg: string, err?: unknown) => void;
}
/** Effective tiers: central when configured there, else the site's local list (enabled ones only, in order). */
export declare function effectiveTiers(cfg: PayConfig, local?: LocalPayConfig): PayTier[];
/** Same rule the service applies on create: null = allowed, else the player-facing reason. */
export declare function payAmountError(cfg: PayConfig, amountCents: number, local?: LocalPayConfig): string | null;
/** HMAC-SHA256(secret, "<timestamp>.<raw body>"), lowercase hex — the zhifu-service response signature. */
export declare function payConfigSignature(secret: string, timestamp: string, body: string): string;
/** 4.4: verify `x-zs-timestamp` / `x-zs-signature`; throws on mismatch (pull falls back to last good / local). */
export declare function checkResponseSignature(o: Pick<PayConfigSyncOptions, "secret" | "requireSignature" | "onLog">, body: string, ts: string | null, sig: string | null, nowSec?: number): void;
/** Pulls `GET /v1/site/pay-config` (signed query), caches it, persists the last good copy. */
export declare function createPayConfigSync(o: PayConfigSyncOptions): {
    get: () => Promise<PayConfig>;
    /** Force a pull now (admin "立即同步", tests). */
    refresh: () => Promise<PayConfig>;
    tiers: () => Promise<PayTier[]>;
    checkAmount: (amountCents: number) => Promise<string | null>;
    /** For `createGlobalPayControls({ settings })`: central gate JSON, or undefined → controls fall back to Redis. */
    gateSettings: () => Promise<Record<string, unknown> | undefined>;
};
export type PayConfigSync = ReturnType<typeof createPayConfigSync>;