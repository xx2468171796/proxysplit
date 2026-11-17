import { z } from "zod";
import type { ChannelAdapter, CreateResult } from "../types.ts";
/**
 * 中转站 (existing gateway) as one upstream: this service is just another app of it.
 * Protocol ported from zhifu `gateway/zhongzhuan.ts`: POST {apiBase}/api/v1/pay/{create,query,lines},
 * flat JSON + HMAC-SHA256 over the canonical form; amounts in yuan on the wire.
 * The gateway treats a callback as delivered when the response body contains "success".
 */
export declare const zhongzhuanCredentials: z.ZodObject<{
    apiBase: z.ZodURL;
    appId: z.ZodString;
    appSecret: z.ZodString;
    callbackSecrets: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type ZhongzhuanCredentials = z.infer<typeof zhongzhuanCredentials>;
export interface ZhongzhuanOptions {
    credentials: ZhongzhuanCredentials;
    /**
     * Pin to one 中转站 channel: sent as `line` on every create unless the player chose a line. The gateway
     * honours it only when that channel passes its own rules (else it routes normally and says
     * line_honored=false) — see docs/architecture.md §3.5.3.
     */
    pinLine?: number | null;
    fetch?: typeof fetch;
    createTimeoutMs?: number;
    queryTimeoutMs?: number;
    now?: () => Date;
}
/** Upstream time → Date; a zone-less "2026-11-01 12:00:00" is Beijing time. Unparsable → null. Pure. */
export declare function parseUpstreamTime(v: unknown): Date | null;
/**
 * A channel pinned to one 中转站 line must not silently be collected by another line (the gateway re-routes
 * when the pinned line is off): fail with a clear reason; the stray upstream order is never shown and expires.
 * A line the player chose keeps the gateway's normal fallback (lineHonored=false tells the page). Pure.
 */
export declare function pinGuard(result: CreateResult, sentLine: unknown, playerLine: string | undefined): CreateResult;
/** Gateway refusal → Chinese for the dialog; known router messages are kept, raw / English get a prefix. */
export declare function upstreamMessage(raw: string | undefined): string;
export declare function zhongzhuanChannel(options: ZhongzhuanOptions): ChannelAdapter;