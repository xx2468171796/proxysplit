import { type MockUpstream } from "../channels/adapters/index.ts";
import type { ChannelAdapter, ChannelFactory, ChannelKind } from "../channels/types.ts";
import { type AttemptPick, type AttemptPort, type SettlePort } from "../engine/index.ts";
import { type ScanGatePorts, type ScanLimiter } from "../scan/index.ts";
import type { StandaloneAttempt, StandaloneChannel, StandaloneOrder, StandaloneSettleTx, StandaloneStore } from "./types.ts";
/**
 * Standalone pipeline (owner 11-04, small projects): create → `/s/` scan gate → upstream only via the shared
 * `openAttemptWith` (hand-off standard inside) → channel callback → shared `settleWith` → `onPaid`.
 * `onPaid` runs once per paid order after the settle commits (claimed first, so concurrent callbacks never run it
 * twice); if it throws, the callback is not acked and the upstream retries. Still make fulfilment idempotent by
 * `orderNo`: a crash between `onPaid` and `markFulfilled` repeats it after the 5-minute claim expires. Same rules as the center (zhifu/risk, routing, scan, handoff, outage text).
 */
export interface StandalonePayOptions {
    store: StandaloneStore;
    /** Public https base of THIS app (callbacks / return URL live here — hand-off standard). */
    publicBaseUrl: string;
    /** ≥ 32 chars; signs scan / session tokens. */
    secret: string;
    onPaid: (order: StandaloneOrder) => Promise<void>;
    /** Tests / demo only: binds the `mock` channel kind (fakes payments). Needs `allowMock: true`; never in production. */
    mock?: MockUpstream;
    allowMock?: boolean;
    factories?: Partial<Record<ChannelKind, ChannelFactory>>;
    /**
     * Scan rate limits (per IP / device / player). Multi-instance: `redisScanLimiter(redis, "<app>:")`.
     * Omitted → an in-process `memoryScanLimiter` (warned once; fine for one instance). `null` = explicit opt-out.
     */
    limiter?: ScanLimiter | null;
    /**
     * Offline geo for the domestic-IP rule (owner: only mainland China IPs pay) — pass `createIpGeo()` from
     * `yanzheng/geo`. Required: `null` is an explicit opt-out (then only `blockUnknownGeo` / the reputation decide).
     */
    ipGeo: ScanGatePorts["ipGeo"] | null;
    ipRep?: ScanGatePorts["ipRep"];
    /** App name / domains: never sent upstream. */
    siteTerms?: readonly string[];
    now?: () => Date;
}
export interface CreateStandaloneOrder {
    merchantRef: string;
    playerKey: string;
    deviceKey?: string | null;
    amountCents: bigint;
    returnUrl?: string | null;
    clientIp?: string | null;
    test?: boolean;
    /** The app's business data (JSON, ≤ 8 KB), handed back on `onPaid` as `order.meta`. */
    meta?: Record<string, unknown> | null;
}
export type CreateOutcome = {
    ok: true;
    orderNo: string;
    scanUrl: string;
    sessionToken: string;
    expiresAt: Date;
} | {
    ok: false;
    code: "COLLECTION_OFF" | "OUTAGE" | "AMOUNT" | "CONFLICT" | "INVALID";
    title: string;
    message: string;
};
export type ScanPage = {
    kind: "jump";
    html: string;
    status: 200;
} | {
    kind: "page";
    html: string;
    status: number;
};
type ChannelPick = AttemptPick & {
    channel: StandaloneChannel;
};
interface Ctx {
    o: StandalonePayOptions;
    now: () => Date;
    base: string;
    adapterOf: (c: StandaloneChannel) => ChannelAdapter | null;
}
/** The standalone tables behind the shared `openAttemptWith`. */
export declare function standaloneAttemptPort(c: Ctx, order: StandaloneOrder): AttemptPort<ChannelPick, StandaloneAttempt>;
export interface ScanClientIn {
    ip: string | null;
    userAgent: string | null;
    query: Record<string, string>;
}
export declare function createStandalonePay(o: StandalonePayOptions): {
    createOrder: (input: CreateStandaloneOrder) => Promise<CreateOutcome>;
    scan: (token: string, client: ScanClientIn) => Promise<ScanPage>;
    /** Player cancel (only the owner, only while pending). */
    cancel: (orderNo: string, playerKey: string) => Promise<boolean>;
    /** Pre-check (5.16 `ensurePayOpen`): the outage text when the outage gate is on and no channel is usable now. */
    outage: () => Promise<{
        title: string;
        body: string;
    } | null>;
    /** 「继续支付」: the same order's QR again while it is pending and not expired; null otherwise / not yours. */
    resume: (orderNo: string, playerKey: string) => Promise<({
        ok: true;
        orderNo: string;
        scanUrl: string;
        sessionToken: string;
        expiresAt: Date;
    } & {
        ok: true;
    }) | null>;
    adapterOf: (ch: StandaloneChannel) => ChannelAdapter | null;
    now: () => Date;
};
export type StandalonePayCore = ReturnType<typeof createStandalonePay>;
/** The store's transaction behind the shared `settleWith`. */
export declare function standaloneSettlePort(tx: StandaloneSettleTx): SettlePort<StandaloneAttempt, StandaloneOrder & {
    test: boolean;
}, {
    status: StandaloneOrder["status"];
    amountCents: bigint;
}>;
/** Channel callback → verify → settle (shared) → onPaid; ack only after fulfilment succeeded. */
export declare function handleStandaloneCallback(pay: StandalonePayCore, o: Pick<StandalonePayOptions, "store" | "onPaid">, code: string, body: string, headers: Readonly<Record<string, string | undefined>>): Promise<{
    status: number;
    body: string;
}>;
export {};