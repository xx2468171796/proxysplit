import type { KeyObject } from "node:crypto";
import { z } from "zod";
import type { CallbackFact, ChannelAdapter, CreateInput, QueryResult } from "../types.ts";
export declare const alipayCredentials: z.ZodObject<{
    apiBase: z.ZodDefault<z.ZodURL>;
    appId: z.ZodString;
    sellerId: z.ZodOptional<z.ZodString>;
    privateKey: z.ZodString;
    alipayPublicKey: z.ZodOptional<z.ZodString>;
    appCertPem: z.ZodOptional<z.ZodString>;
    alipayCertPem: z.ZodOptional<z.ZodString>;
    rootCertPem: z.ZodOptional<z.ZodString>;
    product: z.ZodDefault<z.ZodEnum<{
        page: "page";
        wap: "wap";
    }>>;
    qrProduct: z.ZodOptional<z.ZodEnum<{
        precreate: "precreate";
    }>>;
}, z.core.$strip>;
export type AlipayCredentials = z.infer<typeof alipayCredentials>;
export interface AlipayOptions {
    credentials: AlipayCredentials;
    fetch?: typeof fetch;
    timeoutMs?: number;
    now?: () => Date;
}
/** biz_content of the pay call. Pure. */
export declare function payBiz(product: AlipayCredentials["product"], input: CreateInput): Record<string, unknown>;
/** biz_content of 当面付 precreate (relative timeout: precreate's documented expiry field). Pure. */
export declare function precreateBiz(input: CreateInput, now: Date): Record<string, unknown>;
/** Max bytes read from the cashier page (a real one is ~20 KB). */
export declare const CASHIER_MAX_BYTES: number;
/**
 * Official QR content on an Alipay page.pay cashier page (GBK), or null. Only when the page looks like OUR cashier:
 * the amount shows, or both cashier markers are present (the amount is script-rendered on today's page). Pure.
 */
export declare function cashierQr(html: string, amountYuan?: string): string | null;
type Reply = Record<string, unknown>;
/** Response node + signature check (sign covers the node's raw text). Pure given the key. */
export declare function parseReply(text: string, key: string, alipayKey: KeyObject): {
    node: Reply;
    signedOk: boolean;
};
/** Maps a verified query node for `attemptNo`; anything off → null (never guess). Pure. */
export declare function mapQuery(node: Reply, signedOk: boolean, attemptNo: string): QueryResult | null;
/** Verifies + parses an async notify. null = bad sign / not our app or merchant. Pure given keys. */
export declare function parseNotify(body: string, appId: string, sellerId: string | null, alipayKey: KeyObject, now: Date): CallbackFact | null;
export declare function alipayChannel(options: AlipayOptions): ChannelAdapter;
export {};