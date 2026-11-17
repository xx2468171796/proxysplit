import { X509Certificate } from "node:crypto";
import { yuanToCents } from "../wire.js";
import { z } from "zod";
import { beijingText, certSn, fromBeijingText, loadPrivateKey, loadPublicKey, notifySignText, pidOfAppCert, requestSignText, responseNodeText, rootCertSn, rsa2Sign, rsa2Verify, } from "./alipay-sign.js";
import { isAlipayOfficialLink } from "../../presentation/index.js";
import { yuan2 } from "./huiyitong.js";
/**
 * Direct Alipay (kind `alipay`, our own merchant app — first account 阿龙 = 宣时龙, formerly 中转站 gw-4).
 * Official OpenAPI v1 (`gateway.do`, RSA2), hand-rolled on node:crypto (the official `alipay-sdk` 4.x talks over
 * urllib, which would bypass the hand-off contract suite's fetch capture; the signing code is the gw-4 code that
 * ran in production). Architecture §3.5.8 checklist, item by item:
 * - 6.15: product `page` = page.pay qr_pay_mode 0, cashier fetched server-side, its qr.alipay.com code = `alipay_qr`
 *   (gateway link kept as `checkoutUrl`; no QR → the `page` link). The old pay-gateway way, all this merchant signed.
 * - 6.14: `qrProduct: "precreate"` (当面付) → `alipay_qr` (qr.alipay.com) when the presentation policy wants the QR.
 * - create: `alipay.trade.wap.pay` (product `wap`, QUICK_WAP_WAY) or `alipay.trade.page.pay` (product `page`,
 *   FAST_INSTANT_TRADE_PAY + qr_pay_mode=0, the only product gw-4 had signed). Both are browser-side APIs: we
 *   build the signed GET URL locally (no upstream call) and the player reaches it through our `/s/<token>`
 *   page (`location.href`, no-referrer). Desktop = our /s/ QR (scan-to-create) — the Alipay trade only exists
 *   after a real scan, from the scanning phone, with that phone's IP.
 * - subject = `CreateInput.subject` verbatim (channel `subjectFormat` enforced at save); no goods_detail / body.
 * - notify_url / return_url / quit_url only from `CreateInput` (center domain); return / quit only when set.
 * - time_expire absolute Beijing time = `CreateInput.expiresAt` (never relative timeout_express).
 * - payer IP: `business_params.mc_create_trade_ip` (Alipay's documented risk field for page / wap pay).
 * - query / close / refund / refund query via POST; replies are sign-checked (Alipay public key) before trusted.
 * - notify: form body, RSA2 verify, app_id (+ seller_id when the PID is known) must be ours; only
 *   TRADE_SUCCESS / TRADE_FINISHED count; refund notifies are ignored (refunds settle synchronously).
 */
const keyText = z.string().min(64);
export const alipayCredentials = z
    .object({
    /** Default = production gateway; sandbox: https://openapi-sandbox.dl.alipaydev.com/gateway.do */
    apiBase: z.url().default("https://openapi.alipay.com/gateway.do"),
    appId: z.string().regex(/^\d{16}$/, "APPID 是 16 位数字"),
    /** Merchant PID (2088…); optional, read from the app cert CN in cert mode. Checked against notify seller_id. */
    sellerId: z
        .string()
        .regex(/^2088\d{12}$/)
        .optional(),
    /** App private key (PKCS#8 / PKCS#1, PEM or bare base64). */
    privateKey: keyText,
    /** Public-key mode: the Alipay public key (not the app public key). */
    alipayPublicKey: keyText.optional(),
    /** Cert mode (gw-4): appCertPublicKey_*.crt, alipayCertPublicKey_RSA2.crt, alipayRootCert.crt (full PEM). */
    appCertPem: keyText.optional(),
    alipayCertPem: keyText.optional(),
    rootCertPem: keyText.optional(),
    /** wap = 手机网站支付 (needs that product signed); page = 电脑网站支付 (what gw-4 had). */
    product: z.enum(["wap", "page"]).default("wap"),
    /**
     * 6.14 当面付 (`alipay.trade.precreate`, FACE_TO_FACE_PAYMENT) for the official QR (`alipay_qr`, qr.alipay.com):
     * set only when the merchant has signed 当面付. The presentation policy then asks for the QR on desktop
     * (qrMode desktop) or everywhere (all); other scenes keep `product`.
     */
    qrProduct: z.enum(["precreate"]).optional(),
})
    .refine((c) => Boolean(c.alipayPublicKey) || Boolean(c.appCertPem && c.alipayCertPem && c.rootCertPem), {
    message: "需要 alipayPublicKey（公钥模式）或 appCertPem + alipayCertPem + rootCertPem（证书模式）",
});
function prepareKeys(c) {
    const cert = c.appCertPem && c.alipayCertPem && c.rootCertPem;
    const alipayKey = c.alipayPublicKey
        ? loadPublicKey(c.alipayPublicKey)
        : new X509Certificate(c.alipayCertPem ?? "").publicKey;
    return {
        privateKey: loadPrivateKey(c.privateKey),
        alipayKey,
        certParams: cert && c.appCertPem && c.rootCertPem
            ? { app_cert_sn: certSn(c.appCertPem), alipay_root_cert_sn: rootCertSn(c.rootCertPem) }
            : {},
        sellerId: c.sellerId ?? (c.appCertPem ? pidOfAppCert(c.appCertPem) : null),
    };
}
const PRODUCT = {
    wap: { method: "alipay.trade.wap.pay", code: "QUICK_WAP_WAY", label: "支付宝 H5" },
    page: { method: "alipay.trade.page.pay", code: "FAST_INSTANT_TRADE_PAY", label: "支付宝 电脑网站" },
};
function signed(ctx, method, biz, extra = {}) {
    const params = {
        app_id: ctx.o.credentials.appId,
        method,
        format: "JSON",
        charset: "utf-8",
        sign_type: "RSA2",
        timestamp: beijingText(ctx.now()),
        version: "1.0",
        ...ctx.k.certParams,
        biz_content: JSON.stringify(biz),
        ...extra,
    };
    params.sign = rsa2Sign(requestSignText(params), ctx.k.privateKey);
    return params;
}
/** biz_content of the pay call. Pure. */
export function payBiz(product, input) {
    const biz = {
        out_trade_no: input.attemptNo,
        total_amount: yuan2(input.amountCents),
        subject: input.subject,
        product_code: PRODUCT[product].code,
        time_expire: beijingText(input.expiresAt),
    };
    // qr_pay_mode 0 (+ width 300): the only page.pay mode Alipay serves to a server-side fetch without FISHING_RISK
    // (modes 2 / missing tested 2026-09-12 on app 2021006199696055); the QR is then read off that cashier page.
    if (product === "page") {
        biz.qr_pay_mode = "0";
        biz.qrcode_width = "300";
    }
    if (product === "wap" && input.returnUrl)
        biz.quit_url = input.returnUrl;
    if (input.clientIp)
        biz.business_params = JSON.stringify({ mc_create_trade_ip: input.clientIp });
    return biz;
}
/** biz_content of 当面付 precreate (relative timeout: precreate's documented expiry field). Pure. */
export function precreateBiz(input, now) {
    // Round DOWN (≥ 1 m): the Alipay QR never outlives our attempt by up to a minute (late money still settles).
    const minutes = Math.max(1, Math.floor((input.expiresAt.getTime() - now.getTime()) / 60000));
    return {
        out_trade_no: input.attemptNo,
        total_amount: yuan2(input.amountCents),
        subject: input.subject,
        product_code: "FACE_TO_FACE_PAYMENT",
        timeout_express: `${Math.min(minutes, 120)}m`,
        // Same documented risk field as page / wap pay: the real payer IP (hand-off standard item 5).
        ...(input.clientIp ? { business_params: JSON.stringify({ mc_create_trade_ip: input.clientIp }) } : {}),
    };
}
/**
 * 当面付 QR: one signed POST; the reply must be sign-checked, for OUR out_trade_no, and carry an official
 * https *.alipay.com qr_code — anything else fails (never a guessed link).
 */
async function precreate(ctx, input) {
    try {
        const { node, signedOk } = await call(ctx, "alipay.trade.precreate", precreateBiz(input, ctx.now()), {
            notify_url: input.notifyUrl,
            // Common request parameter; center domain only (hand-off standard item 2), same as wap / page.
            ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
        });
        const qr = str(node.qr_code);
        if (node.code === "10000" && signedOk && str(node.out_trade_no) === input.attemptNo && isAlipayOfficialLink(qr))
            return { ok: true, payUrl: qr, linkKind: "alipay_qr", expiresAt: input.expiresAt, payway: "支付宝 当面付" };
        const why = `${str(node.sub_code) ?? str(node.code) ?? "?"} ${str(node.sub_msg) ?? str(node.msg) ?? ""}`.trim();
        return { ok: false, error: signedOk || node.code !== "10000" ? `支付宝当面付建单失败：${why}` : "支付宝当面付响应验签失败" };
    }
    catch {
        return { ok: false, error: "支付宝当面付建单失败（网络）" };
    }
}
/** Max bytes read from the cashier page (a real one is ~20 KB). */
export const CASHIER_MAX_BYTES = 2 * 1024 * 1024;
/** Markers of Alipay's page.pay QR cashier (qr_pay_mode 0; seen on excashier.alipay.com 2026-11-12). */
const CASHIER_MARKERS = ["J_qrPayArea", "使用手机支付宝"];
/**
 * Official QR content on an Alipay page.pay cashier page (GBK), or null. Only when the page looks like OUR cashier:
 * the amount shows, or both cashier markers are present (the amount is script-rendered on today's page). Pure.
 */
export function cashierQr(html, amountYuan) {
    const isCashier = (amountYuan !== undefined && html.includes(amountYuan)) || CASHIER_MARKERS.every((m) => html.includes(m));
    if (!isCashier)
        return null;
    const hit = html.match(/https:\/\/qr\.alipay\.com\/[A-Za-z0-9_-]{4,64}(?![A-Za-z0-9_-])/);
    return hit && isAlipayOfficialLink(hit[0]) ? hit[0] : null;
}
/** Reads at most `max` bytes of a body (null = over the cap). */
async function cappedBytes(res, max) {
    const reader = res.body?.getReader();
    if (!reader)
        return new Uint8Array(await res.arrayBuffer()).slice(0, max);
    const parts = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        size += value.byteLength;
        if (size > max) {
            await reader.cancel();
            return null;
        }
        parts.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.byteLength;
    }
    return out;
}
/**
 * 6.15 (the old pay-gateway way for 电脑网站支付-only merchants): load the page.pay cashier server-side (desktop UA,
 * no Referer, no cookies, ≤ 6 s, ≤ 2 MB), the final URL must be on *.alipay.com, and read its qr.alipay.com code.
 * null = not found / not a cashier (caller falls back to the cashier link).
 */
async function extractPageQr(ctx, cashierUrl, amountYuan) {
    try {
        const res = await (ctx.o.fetch ?? fetch)(cashierUrl, {
            redirect: "follow",
            referrerPolicy: "no-referrer",
            headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" },
            signal: AbortSignal.timeout(Math.min(ctx.o.timeoutMs ?? 6000, 6000)),
        });
        // Mocks / some runtimes leave res.url empty: then the request URL (our signed gateway URL) is what was loaded.
        if (!isAlipayOfficialLink(res.url || cashierUrl) || res.status !== 200)
            return null;
        const bytes = await cappedBytes(res, CASHIER_MAX_BYTES);
        return bytes ? cashierQr(new TextDecoder("gbk").decode(bytes), amountYuan) : null;
    }
    catch {
        return null;
    }
}
async function create(ctx, input) {
    if (input.wantLink === "alipay_qr" && ctx.o.credentials.qrProduct === "precreate")
        return precreate(ctx, input);
    if (ctx.o.credentials.product === "page" && input.wantLink !== "page") {
        const cashier = await create0(ctx, input);
        if (!cashier.ok || !cashier.payUrl)
            return cashier;
        const qr = await extractPageQr(ctx, cashier.payUrl, yuan2(input.amountCents));
        // No QR → the cashier link itself still pays (one more step), never a failed order.
        return qr ? { ...cashier, payUrl: qr, checkoutUrl: cashier.payUrl, linkKind: "alipay_qr" } : cashier;
    }
    return create0(ctx, input);
}
async function create0(ctx, input) {
    const product = ctx.o.credentials.product;
    try {
        const params = signed(ctx, PRODUCT[product].method, payBiz(product, input), {
            notify_url: input.notifyUrl,
            ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
        });
        // %20 (encodeURIComponent), not "+": same as the official SDK's GET pay URL.
        const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
        const payUrl = `${ctx.o.credentials.apiBase}?${query.join("&")}`;
        return { ok: true, payUrl, linkKind: product === "page" ? "page" : "h5", expiresAt: input.expiresAt, payway: PRODUCT[product].label };
    }
    catch {
        return { ok: false, error: "支付宝直连签名失败（检查应用私钥）" };
    }
}
const str = (v) => (typeof v === "string" && v !== "" ? v : undefined);
/**
 * POSTs one OpenAPI method; returns the `<method>_response` node and whether its sign checked out.
 * Throws on transport errors (callers decide what unknown means).
 */
async function call(ctx, method, biz, extra = {}) {
    const res = await (ctx.o.fetch ?? fetch)(ctx.o.credentials.apiBase, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: new URLSearchParams(signed(ctx, method, biz, extra)),
        signal: AbortSignal.timeout(ctx.o.timeoutMs ?? 15000),
    });
    const text = (await res.text()).replace(/^﻿/, "");
    return parseReply(text, `${method.replace(/\./g, "_")}_response`, ctx.k.alipayKey);
}
/** Response node + signature check (sign covers the node's raw text). Pure given the key. */
export function parseReply(text, key, alipayKey) {
    let whole;
    try {
        whole = JSON.parse(text);
    }
    catch {
        return { node: { code: "-1", sub_msg: "支付宝响应不是 JSON" }, signedOk: false };
    }
    const node = (whole[key] ?? whole.error_response ?? {});
    const raw = responseNodeText(text, key);
    const sign = str(whole.sign);
    return { node, signedOk: Boolean(raw && sign && rsa2Verify(raw, sign, alipayKey)) };
}
/** Maps a verified query node for `attemptNo`; anything off → null (never guess). Pure. */
export function mapQuery(node, signedOk, attemptNo) {
    // Not scanned yet: the trade does not exist upstream. Pending (gw-4 lesson: never a failure); order expiry
    // closes our attempt, and late money still settles.
    if (node.code === "40004" && node.sub_code === "ACQ.TRADE_NOT_EXIST")
        return { status: "pending", amountCents: 0n };
    if (node.code !== "10000" || !signedOk || str(node.out_trade_no) !== attemptNo)
        return null;
    const amountCents = yuanToCents(node.total_amount);
    if (amountCents === null)
        return null;
    const status = str(node.trade_status);
    const tradeNo = str(node.trade_no);
    const base = { amountCents, raw: node, ...(tradeNo ? { upstreamTradeNo: tradeNo } : {}) };
    if (status === "TRADE_SUCCESS" || status === "TRADE_FINISHED") {
        const paidAt = fromBeijingText(str(node.send_pay_date));
        const payer = str(node.buyer_logon_id) ?? str(node.buyer_user_id);
        return { status: "paid", ...base, ...(paidAt ? { paidAt } : {}), ...(payer ? { payerInfo: payer } : {}) };
    }
    if (status === "WAIT_BUYER_PAY")
        return { status: "pending", ...base };
    if (status === "TRADE_CLOSED")
        return { status: "cancelled", ...base };
    return null;
}
async function query(ctx, attemptNo) {
    try {
        const { node, signedOk } = await call(ctx, "alipay.trade.query", { out_trade_no: attemptNo });
        return mapQuery(node, signedOk, attemptNo);
    }
    catch {
        return null;
    }
}
/**
 * Best effort; a trade that never got scanned does not exist yet (ACQ.TRADE_NOT_EXIST) — also fine. Note the
 * signed pay URL stays usable until `time_expire`; money paid after a close still settles as late money.
 */
async function close(ctx, attemptNo) {
    try {
        const { node } = await call(ctx, "alipay.trade.close", { out_trade_no: attemptNo });
        return node.code === "10000" || node.sub_code === "ACQ.TRADE_NOT_EXIST";
    }
    catch {
        return false;
    }
}
/** form body → params (values URL-decoded). Pure. */
function formParams(body) {
    return Object.fromEntries(new URLSearchParams(body).entries());
}
/** Verifies + parses an async notify. null = bad sign / not our app or merchant. Pure given keys. */
export function parseNotify(body, appId, sellerId, alipayKey, now) {
    const p = formParams(body);
    if (!p.sign || !rsa2Verify(notifySignText(p), p.sign, alipayKey))
        return null;
    // Real notifies always carry seller_id: when our PID is known, a missing one fails too.
    if (p.app_id !== appId || (sellerId && p.seller_id !== sellerId))
        return null;
    const attemptNo = p.out_trade_no || null;
    const isRefund = Boolean(p.refund_fee || p.out_biz_no || p.gmt_refund);
    const paid = p.trade_status === "TRADE_SUCCESS" || p.trade_status === "TRADE_FINISHED";
    const amountCents = yuanToCents(p.total_amount);
    if (!attemptNo || isRefund || !paid || amountCents === null)
        return { kind: "other", attemptNo };
    const { sign: _s, sign_type: _t, ...raw } = p;
    return {
        kind: "paid",
        attemptNo,
        amountCents,
        upstreamTradeNo: p.trade_no || null,
        payerInfo: p.buyer_logon_id || p.buyer_id || null,
        paidAt: fromBeijingText(p.gmt_payment) ?? now,
        raw,
    };
}
/**
 * alipay.trade.refund, `out_request_no` = our refund number (idempotent on retry). 10000 + fund_change=Y =
 * refunded now; 10000 + N (repeat request) → confirm with the refund query. ACQ.SYSTEM_ERROR = unknown → pending.
 * Transport errors throw (the request may have reached Alipay; the caller records an unknown outcome).
 */
async function refund(ctx, input) {
    const { node, signedOk } = await call(ctx, "alipay.trade.refund", {
        out_trade_no: input.attemptNo,
        refund_amount: yuan2(input.amountCents),
        out_request_no: input.refundNo,
        ...(input.reason ? { refund_reason: input.reason.slice(0, 256) } : {}),
    });
    if (node.code === "10000" && signedOk) {
        if (node.fund_change === "Y")
            return { status: "succeeded" };
        return (await queryRefund(ctx, input)) ?? { status: "pending" };
    }
    const why = `${str(node.sub_code) ?? str(node.code) ?? "?"} ${str(node.sub_msg) ?? ""}`.trim();
    if (node.code === "10000" || node.sub_code === "ACQ.SYSTEM_ERROR")
        return { status: "pending", error: why };
    return { status: "failed", error: `支付宝拒绝退款：${why}` };
}
async function queryRefund(ctx, input) {
    try {
        const { node, signedOk } = await call(ctx, "alipay.trade.fastpay.refund.query", {
            out_trade_no: input.attemptNo,
            out_request_no: input.refundNo,
        });
        if (node.code !== "10000" || !signedOk)
            return null;
        // Doc: refund data present with refund_status empty or REFUND_SUCCESS = refunded; no data = not (yet) there.
        const done = str(node.refund_amount) && (!node.refund_status || node.refund_status === "REFUND_SUCCESS");
        return done ? { status: "succeeded" } : { status: "pending" };
    }
    catch {
        return null;
    }
}
export function alipayChannel(options) {
    const ctx = { o: options, k: prepareKeys(options.credentials), now: options.now ?? (() => new Date()) };
    return {
        kind: "alipay",
        callbackAck: "success",
        handoff: { clientIp: "sent", expiry: "sent", returnUrl: "sent" },
        // Presentation: 手机网站支付 = an H5 jump link, 电脑网站支付 = a desktop cashier page (no official QR link).
        links: [
            ...(options.credentials.product === "page" ? ["page"] : ["h5"]),
            ...(options.credentials.product === "page" || options.credentials.qrProduct === "precreate"
                ? ["alipay_qr"]
                : []),
        ],
        create: (input) => create(ctx, input),
        query: (attemptNo) => query(ctx, attemptNo),
        close: (attemptNo) => close(ctx, attemptNo),
        verifyCallback: async ({ body }) => parseNotify(body, options.credentials.appId, ctx.k.sellerId, ctx.k.alipayKey, ctx.now()),
        refund: (input) => refund(ctx, input),
        queryRefund: (input) => queryRefund(ctx, input),
    };
}
