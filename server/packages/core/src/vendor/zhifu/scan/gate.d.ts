import { type RegionRules, type ScanClientRules } from "../risk/index.ts";
/**
 * `/s/` scan gate (owner 11-04), both pay modes: checked only right before an upstream create, so a refused scan
 * never costs an Alipay order. Order: client (Alipay / phone / iPad) → IP (central reputation, else local region)
 * → not too fast after the QR was handed out → per scan IP / order device / order player caps. I/O only via ports.
 * The signed `/s/` token, the no-referrer hand-off page and recording a refusal stay with the host (service / server).
 */
/** Why a scan was refused before any upstream call (stored on the order, counted in the funnel). */
export declare const SCAN_REJECT_REASONS: readonly ["not_alipay", "too_fast", "rate_ip", "rate_device", "rate_player", "overseas", "anonymous", "ip_blocked", "ip_risk", "reputation"];
export type ScanRejectReason = (typeof SCAN_REJECT_REASONS)[number];
export interface ScanGateRules extends ScanClientRules, RegionRules {
    /** Rule `scanIp` on / off (central IP reputation, else the region gate). */
    ipGate: boolean;
    minScanDelayMs: number;
    windowMin: number;
    /** 0 = no cap. */
    maxPerIp: number;
    maxPerDevice: number;
    maxPerPlayer: number;
}
/** Fixed-window limiter (Redis in production): true = still under `limit`. */
export interface ScanLimiter {
    hit(key: string, limit: number, windowMs: number): Promise<boolean>;
}
/** Central IP reputation answer (yanzheng/verify-client `IprepResult` fits). null = not configured / no answer. */
export interface ScanIpVerdict {
    verdict: "allow" | "deny";
    reason: "overseas" | "anonymous" | "ip_blocked" | "ip_risk" | null;
    /** Observation period: the verdict is logged, never enforced. */
    observeOnly?: boolean;
}
export interface ScanGatePorts {
    now(): Date;
    ipRep?: {
        check(ip: string): Promise<ScanIpVerdict | null>;
    } | null | undefined;
    /** Offline geo (yanzheng/geo, ip2region). */
    ipGeo?: {
        lookup(ip: string | null | undefined): {
            country: string;
            province: string;
        } | null;
    } | null | undefined;
    /** Injectable for tests; default setTimeout. */
    sleep?: (ms: number) => Promise<void>;
}
export interface ScanGateOrder {
    scanIssuedAt: Date | null;
    createdAt: Date;
    deviceKey: string | null;
    playerKey: string;
}
/** The scanning client, as the transport saw it. */
export interface ScanGateClient {
    ip: string | null;
    userAgent: string | null;
    limiter: ScanLimiter | null;
    query: Readonly<Record<string, string>>;
}
/**
 * The IP check shared by the scan gate and risk rule `orderGeo` (owner 11-05: domestic-IP check at order creation,
 * no extra page): central reputation first; observe-only or no answer → the offline region gate (observe-only never
 * weakens it). null = allowed.
 */
export declare function ipRegionGate(ports: Pick<ScanGatePorts, "ipRep" | "ipGeo">, ip: string | null, rules: RegionRules): Promise<ScanRejectReason | null>;
/** Refusals that are evidence against the scanning IP (scripted / farmed): report them to the reputation. */
export declare const SCAN_REJECTS_BAD_FOR_IP: ReadonlySet<ScanRejectReason>;
/** null = allowed. A phone / tablet jump that is early is held for the rest of the delay (≤ 60 s), not refused. */
export declare function gateScan(ports: ScanGatePorts, order: ScanGateOrder, client: ScanGateClient, rules: ScanGateRules): Promise<ScanRejectReason | null>;