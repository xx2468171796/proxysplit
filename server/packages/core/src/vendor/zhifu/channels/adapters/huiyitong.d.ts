import { type PayLinkKind } from "../../presentation/index.ts";
import { z } from "zod";
import type { ChannelAdapter, CreateInput, QueryResult } from "../types.ts";
/**
 * 汇易通 (third-party aggregator, kind `aggregator`, provider `huiyitong`; first account = 章鱼哥1103).
 * Doc: docs.apipost.net/docs/47765f06889c000 (password with the owner). Protocol:
 * - POST {apiBase}/v2/{pay,query} as form data, MD5 over `k=v&…&secret=<secret>` of EVERY sent field sorted by
 *   key (the doc's example leaves out `type`; verified live 2026-11-03 that `type` is signed), upper-case hex;
 *   success code "000001", pay_url inside the JSON string `data.pay_info`; `method=qr` (CreateInput.wantLink
 *   "alipay_qr", see `zhifu/presentation`) returns `pay_qr` (Alipay's render.alipay.com link) instead.
 * - WeChat (upstream 11-10): desktop `type=wx&method=qr` → `pay_qr` = WeChat Pay code (`wx_qr`, rendered locally);
 *   phone `type=wx&method=jsapi` → `pay_url` = the upstream's https page showing the QR + 长按保存 steps (`wx_h5`,
 *   opened by the player's tap). Base payMethod `jsapi`, desktop switched to `qr` through wantLink (as Alipay wap/qr).
 * - Notify: raw JSON, sign = MD5(`amount=<2 decimals>&app_id&order_id&sys_order_id&type&secret`) per the doc;
 *   the all-fields-sorted form is accepted too (same secret). type `payment.success` = paid, `refund.success` /
 *   `refund.fail` = the async result of an earlier refund; answer the text "SUCCESS".
 * - Refund: POST /v2/refund (app_id, method=refund, order_id), whole upstream order only; "000001" = accepted,
 *   the result arrives later as a refund.* notify.
 * Amounts are yuan with 2 decimals on the wire. Times are UTC without a zone (create_time 04:22 at 12:22 Beijing).
 */
export declare const huiyitongCredentials: z.ZodObject<{
    provider: z.ZodLiteral<"huiyitong">;
    apiBase: z.ZodURL;
    appId: z.ZodString;
    secret: z.ZodString;
    payType: z.ZodDefault<z.ZodEnum<{
        alipay: "alipay";
        wx: "wx";
    }>>;
    payMethod: z.ZodDefault<z.ZodEnum<{
        wap: "wap";
        app: "app";
        qr: "qr";
        wx_mini: "wx_mini";
        jsapi: "jsapi";
    }>>;
    clientIpField: z.ZodOptional<z.ZodString>;
    expireField: z.ZodOptional<z.ZodString>;
    expireFormat: z.ZodDefault<z.ZodEnum<{
        unix: "unix";
        seconds: "seconds";
    }>>;
}, z.core.$strip>;
export type HuiyitongCredentials = z.infer<typeof huiyitongCredentials>;
export interface HuiyitongOptions {
    credentials: HuiyitongCredentials;
    fetch?: typeof fetch;
    createTimeoutMs?: number;
    queryTimeoutMs?: number;
    now?: () => Date;
}
/** Integer cents → "12.30" (the upstream signs the 2-decimal text). Pure. */
export declare function yuan2(cents: bigint): string;
/** MD5 of `k=v&…&secret=…` over `fields` in the listed order, upper-case hex. Pure. */
export declare function huiyitongSign(params: Record<string, string>, fields: readonly string[], secret: string): string;
/** Signs every field of a request, sorted by key. Pure. */
export declare function signForm(form: Record<string, string>, secret: string): string;
declare const replySchema: z.ZodObject<{
    code: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>;
    msg: z.ZodOptional<z.ZodString>;
    message: z.ZodOptional<z.ZodString>;
    result: z.ZodOptional<z.ZodString>;
    data: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strip>;
type Reply = z.infer<typeof replySchema>;
/** `data.pay_info` is a JSON string (sometimes an object); returns its fields or null. Pure. */
export declare function payInfoOf(data: unknown): Record<string, unknown> | null;
/** 「支付宝 H5」 — the 通道 / 方式 label stored on the attempt and shown in 查账. Pure. */
export declare function huiyitongPayway(c: Pick<HuiyitongCredentials, "payType" | "payMethod">): string;
/** Optional hand-off fields (payer IP / expiry) when the credentials name them. Pure. */
export declare function handoffFields(c: HuiyitongCredentials, input: CreateInput, now: Date): Record<string, string>;
/**
 * Link kinds a 汇易通 account can return: Alipay accounts have the official QR (method=qr → pay_qr); a WeChat
 * account with payMethod qr returns only the WeChat Pay code (`wx_qr`). Pure.
 */
export declare function huiyitongLinks(c: Pick<HuiyitongCredentials, "payType" | "payMethod">): PayLinkKind[];
type QueryExpect = {
    attemptNo: string;
    appId: string;
    payType?: PayType;
};
/**
 * Only a well-formed answer for THIS order (order_id / app_id match when present) with a known status and a
 * valid amount counts; anything else → null (unknown — never guess).
 */
export declare function parseHuiyitongQuery(reply: Reply, expect?: QueryExpect): QueryResult | null;
type PayType = "alipay" | "wx";
/** Upstream time; zone-less text uses the pay type's zone (default UTC). Unparsable → null. Pure. */
export declare function upstreamTime(v: unknown, payType?: PayType): Date | null;
/** @deprecated use upstreamTime(v, payType); kept for 6.x callers (always UTC). Pure. */
export declare function upstreamUtc(v: unknown): Date | null;
export declare function huiyitongChannel(options: HuiyitongOptions): ChannelAdapter;
export {};