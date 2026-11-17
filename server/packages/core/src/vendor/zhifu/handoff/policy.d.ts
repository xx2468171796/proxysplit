import type { CreateInput } from "../channels/types.ts";
import type { PayLinkKind, PayScene } from "../presentation/index.ts";
/**
 * Channel hand-off standard (owner 2026-11-04, learned from dissecting 章鱼哥1103 — knowledge ev:1203 / ev:1207):
 * what the payment company (Alipay / WeChat behind any channel) may see of an order. Every adapter receives
 * only a `CreateInput` that passed `handoffViolations`; docs = INTEGRATION §6.0「跳转与防穿透风控标准」.
 * Same code in both modes: zhifu-service (center) and `zhifu/server` (standalone) build inputs only here.
 *
 * 1. Neutral subject / body: only the channel-generated text (`subjectFormat`) or 订单号：<尝试号>, never the site's
 *    order title; the denylist below + per-site terms re-check it.
 * 2. notify_url / return_url only on the payment-center domain (never a game site).
 * 3. Client hand-off = our page doing `location.href` with `Referrer-Policy: no-referrer` (never a server 302) —
 *    enforced by the /s/ route (zhifu-service `apps/api/src/routes/scan.ts`; standalone `zhifu/server`).
 * 4. Upstream order expiry aligned to our QR TTL (sent when the channel API has an expiry field).
 * 5. The real payer IP (scan IP first) when the channel API has a client-IP field — never 127.0.0.1 / private.
 * 6. Scan-to-create gate before creating upstream orders (per-site switch; judgement in `zhifu/risk`).
 * All functions here are pure.
 */
/** Words that tie an order to a game / recharge business. Matched case-insensitively as substrings. */
export declare const SUBJECT_DENYLIST: readonly string[];
/** Fallback upstream text when a channel has no `subjectFormat` and the order's own subject is not neutral. */
export declare function neutralSubject(attemptNo: string): string;
/** Denylisted / site-specific terms found in `text` (lower-cased, de-duplicated). */
export declare function subjectViolations(text: string, extraTerms?: readonly string[]): string[];
/** Host-only terms of a URL / domain list (e.g. `gx.zygskins.cn` → also `zygskins`), for the per-site denylist. */
export declare function siteTerms(input: {
    name?: string | null;
    urls?: readonly (string | null | undefined)[];
}): string[];
/** True when `url` is https on exactly the payment-center host (`publicBaseUrl`). */
export declare function isCenterUrl(url: string, centerBase: string): boolean;
/** The IP as-is when it is a public address; loopback / private / malformed → null (never send 127.0.0.1). */
export declare function publicIp(raw: string | null | undefined): string | null;
/**
 * Payer IP to pass upstream: on a scan-to-create order ONLY the Alipay scan IP (the device that pays; the
 * ordering IP may be another device), otherwise the ordering IP. Not public → null (send nothing).
 */
export declare function payerIpOf(order: {
    scanToCreate?: boolean | null;
    scanIp?: string | null;
    clientIp?: string | null;
}): string | null;
/** Upstream order expiry = our QR expiry: min(order expiry, now + qrTtlSec); no TTL rule → the order's. */
export declare function upstreamExpiry(input: {
    now: Date;
    orderExpiresAt: Date;
    qrTtlSec?: number | undefined;
}): Date;
export interface HandoffSource {
    attemptNo: string;
    amountCents: bigint;
    /** Channel-generated subject (`subjectFormat`), else null → 订单号：<尝试号>. The order's own title is never sent. */
    generatedSubject: string | null;
    orderReturnUrl: string | null;
    channelCode: string;
    centerBase: string;
    line: string | null;
    isSplit: boolean;
    payerIp: string | null;
    expiresAt: Date;
    /** Site name / domains: never allowed in what goes upstream. */
    siteTerms: readonly string[];
    /** Payer scene + the link kind the presentation policy wants (`zhifu/presentation`); passed through as is. */
    scene?: PayScene;
    wantLink?: PayLinkKind | null;
}
/** The only way a `CreateInput` is built for a real upstream call. */
export declare function buildHandoffInput(s: HandoffSource): CreateInput;
/** Contract check of a built input; [] = compliant. Used right before `adapter.create` (fail closed). */
export declare function handoffViolations(input: CreateInput, centerBase: string, extraTerms?: readonly string[]): string[];