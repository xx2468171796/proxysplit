import { createHash, timingSafeEqual } from "node:crypto";
import { yuanToCents } from "../wire.js";
import { isAlipayOfficialLink, isUpstreamPayPage, isWechatOfficialLink } from "../../presentation/index.js";
import { z } from "zod";
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
export const huiyitongCredentials = z.object({
    provider: z.literal("huiyitong"),
    apiBase: z.url(),
    appId: z.string().min(1),
    secret: z.string().min(1),
    /** alipay | wx */
    payType: z.enum(["alipay", "wx"]).default("alipay"),
    /** app | wap | qr | wx_mini | jsapi (WeChat phone page, 6.12) */
    payMethod: z.enum(["app", "wap", "qr", "wx_mini", "jsapi"]).default("wap"),
    /**
     * Hand-off standard (§3.5.8): form field for the real payer IP, e.g. "client_ip". Unset = not sent (the doc's
     * /v2/pay field list has none, and every sent field is signed — only turn on once the upstream confirms).
     */
    clientIpField: z
        .string()
        .regex(/^[a-z_]{2,32}$/)
        .optional(),
    /** Form field for the upstream order expiry, e.g. "time_expire"; unset = not sent (same caveat). */
    expireField: z
        .string()
        .regex(/^[a-z_]{2,32}$/)
        .optional(),
    /** How the expiry is written: unix seconds (Ping++ `time_expire`) or seconds from now. */
    expireFormat: z.enum(["unix", "seconds"]).default("unix"),
});
const OK = "000001";
const NOTIFY_SIGN_FIELDS = ["amount", "app_id", "order_id", "sys_order_id", "type"];
/** Integer cents → "12.30" (the upstream signs the 2-decimal text). Pure. */
export function yuan2(cents) {
    return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
/** MD5 of `k=v&…&secret=…` over `fields` in the listed order, upper-case hex. Pure. */
export function huiyitongSign(params, fields, secret) {
    const text = [...fields.map((k) => `${k}=${params[k] ?? ""}`), `secret=${secret}`].join("&");
    return createHash("md5").update(text, "utf8").digest("hex").toUpperCase();
}
/** Signs every field of a request, sorted by key. Pure. */
export function signForm(form, secret) {
    return huiyitongSign(form, Object.keys(form).sort(), secret);
}
function sameSign(a, b) {
    const x = Buffer.from(a.toUpperCase());
    const y = Buffer.from(b.toUpperCase());
    return x.length === y.length && timingSafeEqual(x, y);
}
const str = (v) => typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : undefined;
const replySchema = z.object({
    code: z.union([z.string(), z.number()]).optional(),
    msg: z.string().optional(),
    message: z.string().optional(),
    result: z.string().optional(),
    data: z.unknown().optional(),
});
async function post(options, path, form, timeoutMs) {
    const res = await (options.fetch ?? fetch)(`${options.credentials.apiBase.replace(/\/$/, "")}/v2/${path}`, {
        method: "POST",
        body: new URLSearchParams(form),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    try {
        const parsed = replySchema.safeParse(JSON.parse(text));
        if (parsed.success)
            return parsed.data;
    }
    catch {
        // fall through
    }
    return { code: "-1", msg: `汇易通响应格式不对（HTTP ${res.status}）` };
}
/** `data.pay_info` is a JSON string (sometimes an object); returns its fields or null. Pure. */
export function payInfoOf(data) {
    const raw = data && typeof data === "object" ? data.pay_info : undefined;
    const info = typeof raw === "string" ? safeJson(raw) : raw;
    return info && typeof info === "object" && !Array.isArray(info) ? info : null;
}
function safeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function failText(reply) {
    const info = reply.data && typeof reply.data === "object" ? str(reply.data.error_info) : undefined;
    const m = info ?? reply.msg ?? reply.message ?? (typeof reply.data === "string" ? reply.data : undefined);
    return m ? `汇易通下单失败：${m}` : `汇易通下单失败（code ${String(reply.code ?? "?")}）`;
}
const TYPE_LABEL = { alipay: "支付宝", wx: "微信" };
const METHOD_LABEL = { app: "APP", wap: "H5", qr: "扫码", wx_mini: "小程序", jsapi: "手机页" };
/** 「支付宝 H5」 — the 通道 / 方式 label stored on the attempt and shown in 查账. Pure. */
export function huiyitongPayway(c) {
    return `${TYPE_LABEL[c.payType]} ${METHOD_LABEL[c.payMethod]}`;
}
/** Optional hand-off fields (payer IP / expiry) when the credentials name them. Pure. */
export function handoffFields(c, input, now) {
    const out = {};
    if (c.clientIpField && input.clientIp)
        out[c.clientIpField] = input.clientIp;
    if (c.expireField) {
        const unix = Math.floor(input.expiresAt.getTime() / 1000);
        out[c.expireField] = String(c.expireFormat === "unix" ? unix : Math.max(1, unix - Math.floor(now.getTime() / 1000)));
    }
    return out;
}
/**
 * Link kinds a 汇易通 account can return: Alipay accounts have the official QR (method=qr → pay_qr); a WeChat
 * account with payMethod qr returns only the WeChat Pay code (`wx_qr`). Pure.
 */
export function huiyitongLinks(c) {
    if (c.payType === "wx")
        return c.payMethod === "qr" ? ["wx_qr"] : ["wx_h5", "wx_qr"];
    return c.payMethod === "qr" ? ["alipay_qr"] : ["h5", "alipay_qr"];
}
/** The QR kind of an account (alipay_qr / wx_qr), or null when it has none. Pure. */
function qrKindOf(links) {
    return links.includes("wx_qr") ? "wx_qr" : links.includes("alipay_qr") ? "alipay_qr" : null;
}
/** `pay_qr` of a QR order: official Alipay link (alipay_qr) or WeChat Pay code (wx_qr), else the attempt fails. */
function qrLinkOf(raw, qr) {
    const wx = qr === "wx_qr";
    if (raw && (wx ? isWechatOfficialLink(raw) : isAlipayOfficialLink(raw)))
        return { url: raw, kind: qr };
    if (!raw)
        return { error: "汇易通未返回二维码链接" };
    return { error: wx ? "汇易通二维码链接不是微信支付官方链接，已拒绝" : "汇易通二维码链接不是支付宝官方域名，已拒绝" };
}
/** `pay_url`: Alipay H5 as before; a WeChat phone page (wx_h5) only when it is a clean https upstream page. */
function pageLinkOf(url, wx) {
    if (!url)
        return { error: "汇易通未返回支付链接" };
    if (!wx)
        return { url, kind: "h5" };
    return isUpstreamPayPage(url)
        ? { url, kind: "wx_h5" }
        : { error: "汇易通微信付款页链接不合规（须 https 且不带其它网址），已拒绝" };
}
function linkOf(info, qr, wx) {
    if (!info)
        return {};
    return qr ? qrLinkOf(str(info.pay_qr), qr) : pageLinkOf(str(info.pay_url), wx);
}
async function create(options, input) {
    const c = options.credentials;
    const links = huiyitongLinks(c);
    const kind = qrKindOf(links);
    const qr = kind && (input.wantLink === kind || links[0] === kind) ? kind : null;
    const method = qr ? "qr" : c.payMethod;
    const form = {
        app_id: c.appId,
        type: c.payType,
        method,
        order_id: input.attemptNo,
        amount: yuan2(input.amountCents),
        goods_title: input.subject,
        goods_desc: input.subject,
        notify_url: input.notifyUrl,
        ...handoffFields(c, input, (options.now ?? (() => new Date()))()),
    };
    form.sign = signForm(form, c.secret);
    try {
        const reply = await post(options, "pay", form, options.createTimeoutMs ?? 15000);
        const info = String(reply.code) === OK ? payInfoOf(reply.data) : null;
        const link = linkOf(info, qr, c.payType === "wx");
        if (!link.url || !link.kind)
            return { ok: false, error: link.error ?? failText(reply) };
        const result = {
            ok: true,
            payUrl: link.url,
            linkKind: link.kind,
            payway: huiyitongPayway({ payType: c.payType, payMethod: method }),
        };
        const sys = str(info?.sys_order_id);
        if (sys)
            result.channelOrderNo = sys;
        return result;
    }
    catch {
        return { ok: false, error: "汇易通通讯失败" };
    }
}
/**
 * Query reply (doc: 开发中; shape verified live 2026-11-03): `code` "000003" + `result` "success", the order as a
 * JSON string in `data.order_info` (`status`, `amount` in yuan, `order_id`, `sys_order_id`, `app_id`). Unknown
 * order → `result` "fail" (code Q10006). Status values are the merchant admin's set (order list template):
 * none 创建 / pending 未支付 / waiting 待支付 / success 已支付 / fail 失败.
 */
const PAID = new Set(["success"]);
const PENDING = new Set(["none", "pending", "waiting"]);
const FAILED = new Set(["fail"]);
const QUERY_OK = new Set([OK, "000003"]);
/** `data.order_info` (or the older `pay_info`) as an object; null when missing / not JSON. Pure. */
function orderInfoOf(data) {
    if (!data || typeof data !== "object")
        return null;
    const raw = data.order_info;
    const info = typeof raw === "string" ? safeJson(raw) : raw;
    if (info && typeof info === "object" && !Array.isArray(info))
        return info;
    return payInfoOf(data);
}
/** The order fields of a successful query reply that belong to `expect` (when given); else null. Pure. */
function queriedOrder(reply, expect) {
    if (!QUERY_OK.has(String(reply.code)) || (reply.result !== undefined && reply.result !== "success"))
        return null;
    const fields = orderInfoOf(reply.data);
    if (!fields || !expect)
        return fields;
    const mismatch = (key, want) => {
        const got = str(fields[key]);
        // order_id must be present and ours; app_id is checked only when the reply carries it.
        return key === "order_id" ? got !== want : got !== undefined && got !== want;
    };
    return mismatch("order_id", expect.attemptNo) || mismatch("app_id", expect.appId) ? null : fields;
}
function mapStatus(v) {
    const status = String(v ?? "").toLowerCase();
    if (PAID.has(status))
        return "paid";
    if (PENDING.has(status))
        return "pending";
    return FAILED.has(status) ? "cancelled" : null;
}
/**
 * Only a well-formed answer for THIS order (order_id / app_id match when present) with a known status and a
 * valid amount counts; anything else → null (unknown — never guess).
 */
export function parseHuiyitongQuery(reply, expect) {
    const fields = queriedOrder(reply, expect);
    const mapped = fields ? mapStatus(fields.status) : null;
    const amountCents = fields ? yuanToCents(fields.amount) : null;
    if (!fields || !mapped || amountCents === null)
        return null;
    const result = { status: mapped, amountCents, raw: fields };
    const sys = str(fields.sys_order_id);
    if (sys)
        result.upstreamTradeNo = sys;
    const paidAt = mapped === "paid" ? upstreamTime(fields.pay_time, expect?.payType) : null;
    if (paidAt)
        result.paidAt = paidAt;
    return result;
}
async function query(options, attemptNo) {
    const form = { app_id: options.credentials.appId, method: "query", order_id: attemptNo };
    form.sign = signForm(form, options.credentials.secret);
    try {
        const reply = await post(options, "query", form, options.queryTimeoutMs ?? 10000);
        return parseHuiyitongQuery(reply, { attemptNo, appId: options.credentials.appId, payType: options.credentials.payType });
    }
    catch {
        return null;
    }
}
const HAS_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
/**
 * Zone of zone-less upstream times, per pay type (observed live): Alipay accounts send UTC (zyg1103,
 * 11-03..11-09: pay_time ≈ our receive time in UTC), WeChat accounts send Beijing time (zyg1103wx, 11-10:
 * pay_time "21:17:32" received at 13:17:32Z). Pure.
 */
const ZONE = { alipay: "Z", wx: "+08:00" };
/** Upstream time; zone-less text uses the pay type's zone (default UTC). Unparsable → null. Pure. */
export function upstreamTime(v, payType = "alipay") {
    const text = str(v)?.trim();
    if (!text)
        return null;
    const d = new Date(HAS_ZONE.test(text) ? text : `${text.replace(" ", "T")}${ZONE[payType]}`);
    return Number.isFinite(d.getTime()) ? d : null;
}
/** @deprecated use upstreamTime(v, payType); kept for 6.x callers (always UTC). Pure. */
export function upstreamUtc(v) {
    return upstreamTime(v, "alipay");
}
/** Doc field list first, then every field sorted (same secret either way). Pure. */
function notifySigned(d, params, sign, secret) {
    if (sameSign(sign, huiyitongSign(params, NOTIFY_SIGN_FIELDS, secret)))
        return true;
    const all = {};
    for (const [k, v] of Object.entries(d)) {
        const text = str(v);
        if (k !== "sign" && text !== undefined)
            all[k] = text;
    }
    return sameSign(sign, signForm(all, secret));
}
/** Parses + checks app_id and signature; null = reject. */
function verifiedNotify(options, body) {
    const data = safeJson(body);
    if (!data || typeof data !== "object" || Array.isArray(data))
        return null;
    const d = data;
    const sign = str(d.sign);
    const amountCents = yuanToCents(d.amount);
    if (!sign || amountCents === null)
        return null;
    const params = { amount: yuan2(amountCents) };
    for (const k of NOTIFY_SIGN_FIELDS.slice(1))
        params[k] = str(d[k]) ?? "";
    if (params.app_id !== options.credentials.appId)
        return null;
    return notifySigned(d, params, sign, options.credentials.secret) ? { d, params, amountCents } : null;
}
function refundFact(d, attemptNo) {
    const succeeded = d.type === "refund.success";
    const why = str(d.error_info) ?? str(d.msg) ?? str(d.reason);
    return { kind: "refund", attemptNo, succeeded, error: succeeded ? null : `汇易通退款失败${why ? `：${why}` : ""}` };
}
function verifyCallback(options, body) {
    const v = verifiedNotify(options, body);
    if (!v)
        return null;
    const { d, params, amountCents } = v;
    const attemptNo = params.order_id || null;
    if (attemptNo && (d.type === "refund.success" || d.type === "refund.fail"))
        return refundFact(d, attemptNo);
    if (d.type !== "payment.success" || !attemptNo)
        return { kind: "other", attemptNo };
    const { sign: _omit, ...raw } = d;
    return {
        kind: "paid",
        attemptNo,
        amountCents,
        upstreamTradeNo: params.sys_order_id || null,
        payerInfo: str(d.open_id) ?? null,
        paidAt: upstreamTime(d.pay_time, options.credentials.payType) ?? (options.now ?? (() => new Date()))(),
        raw,
    };
}
/** Error text of a refusal: data.error_info (seen live), msg, or the code. Pure. */
function refusal(reply) {
    const info = reply.data && typeof reply.data === "object" ? str(reply.data.error_info) : undefined;
    return info ?? reply.msg ?? reply.message ?? `code ${String(reply.code ?? "?")}`;
}
/**
 * Whole-order refund only: a partial amount fails up front (nothing is sent, the reservation is released).
 * Accepted → `pending`; the site is told when the refund.* notify arrives. A transport error throws so the
 * caller records an unknown outcome for a human (the request may have reached the upstream).
 */
async function refund(options, input) {
    if (input.attemptCents === null || input.amountCents !== input.attemptCents) {
        const whole = input.attemptCents === null ? "" : `（这笔是 ¥${yuan2(input.attemptCents)}）`;
        return { status: "failed", error: `汇易通只能整笔退款${whole}，请按整笔金额退` };
    }
    const form = {
        app_id: options.credentials.appId,
        method: "refund",
        order_id: input.attemptNo,
    };
    form.sign = signForm(form, options.credentials.secret);
    const reply = await post(options, "refund", form, options.createTimeoutMs ?? 15000);
    if (String(reply.code) === OK)
        return { status: "pending" };
    return { status: "failed", error: `汇易通拒绝退款：${refusal(reply)}` };
}
export function huiyitongChannel(options) {
    return {
        kind: "aggregator",
        callbackAck: "SUCCESS",
        handoff: {
            clientIp: options.credentials.clientIpField ? "sent" : "unsupported",
            expiry: options.credentials.expireField ? "sent" : "unsupported",
            returnUrl: "never",
        },
        links: huiyitongLinks(options.credentials),
        create: (input) => create(options, input),
        query: (attemptNo) => query(options, attemptNo),
        verifyCallback: async ({ body }) => verifyCallback(options, body),
        refund: (input) => refund(options, input),
    };
}
