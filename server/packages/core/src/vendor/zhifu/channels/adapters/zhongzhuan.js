import { centsToYuan, parseFlatJson, signParams, verifySignature, yuanToCents } from "../wire.js";
import { z } from "zod";
/**
 * 中转站 (existing gateway) as one upstream: this service is just another app of it.
 * Protocol ported from zhifu `gateway/zhongzhuan.ts`: POST {apiBase}/api/v1/pay/{create,query,lines},
 * flat JSON + HMAC-SHA256 over the canonical form; amounts in yuan on the wire.
 * The gateway treats a callback as delivered when the response body contains "success".
 */
export const zhongzhuanCredentials = z.object({
    apiBase: z.url(),
    appId: z.string().min(1),
    appSecret: z.string().min(1),
    callbackSecrets: z.array(z.string().min(1)).optional(),
});
const replySchema = z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
});
const STATUS = {
    PENDING: "pending",
    PAID: "paid",
    EXPIRED: "expired",
    CANCELLED: "cancelled",
};
const str = (v) => (typeof v === "string" && v !== "" ? v : undefined);
const HAS_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
/** Upstream time → Date; a zone-less "2026-11-01 12:00:00" is Beijing time. Unparsable → null. Pure. */
export function parseUpstreamTime(v) {
    const text = str(v)?.trim();
    if (!text)
        return null;
    const iso = HAS_ZONE.test(text) ? text : `${text.replace(" ", "T")}+08:00`;
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d : null;
}
function parseCreate(data) {
    const payUrl = str(data.qr_code);
    if (!payUrl)
        return { ok: false, error: "中转站未返回二维码" };
    const expireAt = parseUpstreamTime(data.expire_at);
    const line = data.line;
    const result = { ok: true, payUrl, linkKind: "h5", lineHonored: data.line_honored !== false };
    const checkoutUrl = str(data.checkout_url);
    const payTip = str(data.pay_tip);
    const channelOrderNo = str(data.out_trade_no) ?? str(data.sn);
    if (checkoutUrl)
        result.checkoutUrl = checkoutUrl;
    if (payTip)
        result.payTip = payTip;
    if (channelOrderNo)
        result.channelOrderNo = channelOrderNo;
    if (expireAt)
        result.expiresAt = expireAt;
    if (typeof line === "number" || typeof line === "string")
        result.line = String(line);
    return result;
}
/**
 * A channel pinned to one 中转站 line must not silently be collected by another line (the gateway re-routes
 * when the pinned line is off): fail with a clear reason; the stray upstream order is never shown and expires.
 * A line the player chose keeps the gateway's normal fallback (lineHonored=false tells the page). Pure.
 */
export function pinGuard(result, sentLine, playerLine) {
    if (!result.ok || playerLine || typeof sentLine !== "number" || result.lineHonored !== false)
        return result;
    const other = result.line ? `，中转站改派到 #${result.line}，已拒用` : "";
    return { ok: false, error: `上游通道已停用或不可用（中转站侧 #${sentLine}）${other}` };
}
/** Gateway refusal → Chinese for the dialog; known router messages are kept, raw / English get a prefix. */
export function upstreamMessage(raw) {
    if (!raw)
        return "中转站下单失败";
    if (/没有激活的支付渠道|指定收款主体暂不可用/.test(raw))
        return `上游通道已停用（中转站侧）：${raw}`;
    return /[\u4e00-\u9fff]/.test(raw) ? raw : `中转站下单失败：${raw}`;
}
async function call(options, path, params, timeoutMs) {
    const creds = options.credentials;
    const now = options.now ?? (() => new Date());
    const body = { ...params, app_id: creds.appId, timestamp: Math.floor(now().getTime() / 1000) };
    const res = await (options.fetch ?? fetch)(`${creds.apiBase}/api/v1/pay/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, sign: signParams(body, creds.appSecret) }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const parsed = replySchema.safeParse(await res.json());
    return parsed.success ? parsed.data : { code: -1, message: "中转站响应格式不对" };
}
async function create(options, input) {
    const params = {
        app_order_no: input.attemptNo,
        amount: Number(centsToYuan(input.amountCents)),
        subject: input.subject,
        order_type: "recharge",
        notify_url: input.notifyUrl,
    };
    if (input.returnUrl)
        params.return_url = input.returnUrl;
    if (input.line && /^\d+$/.test(input.line))
        params.line = Number(input.line);
    else if (options.pinLine)
        params.line = options.pinLine;
    if (input.isSplit)
        params.split = 1;
    try {
        const reply = await call(options, "create", params, options.createTimeoutMs ?? 15000);
        if (reply.code === 0 && reply.data)
            return pinGuard(parseCreate(reply.data), params.line, input.line ?? undefined);
        return { ok: false, error: upstreamMessage(reply.message) };
    }
    catch {
        return { ok: false, error: "中转站通讯失败" };
    }
}
function parseQuery(data) {
    const status = STATUS[String(data.status)];
    const amountCents = yuanToCents(data.amount);
    if (!status || amountCents === null)
        return null;
    const result = { status, amountCents, raw: data };
    const trade = str(data.trade_no) ?? str(data.out_trade_no);
    const payer = str(data.payer_info);
    const paidAt = parseUpstreamTime(data.paid_at);
    if (trade)
        result.upstreamTradeNo = trade;
    if (payer)
        result.payerInfo = payer;
    if (paidAt)
        result.paidAt = paidAt;
    return result;
}
async function query(options, attemptNo) {
    try {
        const reply = await call(options, "query", { app_order_no: attemptNo }, options.queryTimeoutMs ?? 10000);
        return reply.code === 0 && reply.data ? parseQuery(reply.data) : null;
    }
    catch {
        return null;
    }
}
const lineSchema = z.object({
    id: z.union([z.number(), z.string()]),
    name: z.string().min(1),
    usable: z.boolean().optional(),
    reason: z.string().nullable().optional(),
    recommended: z.boolean().optional(),
});
async function listLines(options, amountCents) {
    try {
        const params = { amount: Number(centsToYuan(amountCents)) };
        const reply = await call(options, "lines", params, options.queryTimeoutMs ?? 10000);
        const lines = reply.data?.lines;
        if (reply.code !== 0 || !Array.isArray(lines))
            return [];
        return lines.flatMap((raw) => {
            const l = lineSchema.safeParse(raw);
            if (!l.success)
                return [];
            if (options.pinLine && String(l.data.id) !== String(options.pinLine))
                return [];
            const { id, name, usable, reason, recommended } = l.data;
            return [
                { id: String(id), name, usable: usable === true, reason: reason ?? null, recommended: recommended === true },
            ];
        });
    }
    catch {
        return [];
    }
}
function verifyCallback(options, body) {
    const creds = options.credentials;
    const data = parseFlatJson(body);
    if (!data || typeof data.sign !== "string")
        return null;
    const { sign, ...params } = data;
    const secrets = creds.callbackSecrets?.length ? creds.callbackSecrets : [creds.appSecret];
    if (!verifySignature(params, sign, secrets))
        return null;
    const attemptNo = str(data.app_order_no) ?? null;
    const amountCents = yuanToCents(data.amount);
    if (data.status !== "PAID" || !attemptNo || amountCents === null)
        return { kind: "other", attemptNo };
    const paidAt = parseUpstreamTime(data.paid_at);
    return {
        kind: "paid",
        attemptNo,
        amountCents,
        upstreamTradeNo: str(data.trade_no) ?? str(data.out_trade_no) ?? null,
        payerInfo: str(data.payer_info) ?? null,
        paidAt: paidAt ?? (options.now ?? (() => new Date()))(),
        raw: params,
    };
}
export function zhongzhuanChannel(options) {
    return {
        kind: "zhongzhuan",
        callbackAck: "success",
        // The 中转站 API has no payer-IP / expiry fields (it stamps its own 15-minute expire_at).
        handoff: { clientIp: "unsupported", expiry: "unsupported", returnUrl: "sent" },
        links: ["h5"],
        create: (input) => create(options, input),
        query: (attemptNo) => query(options, attemptNo),
        listLines: (amountCents) => listLines(options, amountCents),
        verifyCallback: async ({ body }) => verifyCallback(options, body),
        // Refunds: the gateway's refund API is not exposed to apps yet → recorded as manual (docs, open question 3).
        refund: async () => ({ status: "unsupported", error: "中转站未开放退款接口，请在中转站后台人工退款" }),
    };
}
