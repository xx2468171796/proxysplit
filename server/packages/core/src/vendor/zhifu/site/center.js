import { createHash, randomBytes } from "node:crypto";
import { redeemHumanToken } from "./human-verify.js";
import { unpaidNoticeText } from "../client/pay-session.js";
import { parsePayUi, refusalPayUi, uiCheckResult, uiOutage, uiPayNotice } from "../center/ui.js";
import { settle } from "../center/errors.js";
import { notifyHandler } from "../center/notify.js";
const CODE_MAP = {
    COOLDOWN: "COOLDOWN",
    QUEUE_FULL: "QUEUE_FULL",
    QUEUED: "QUEUED",
    CHALLENGE_REQUIRED: "CHALLENGE_REQUIRED",
    PAY_BANNED: "PAY_BANNED",
    AMOUNT_INVALID: "AMOUNT_INVALID",
    SPLIT_TOO_LARGE: "AMOUNT_INVALID",
    COLLECTION_OFF: "COLLECTION_OFF",
    SITE_DISABLED: "COLLECTION_OFF",
    NO_CHANNEL: "CHANNEL_BUSY",
    PAY_OUTAGE: "OUTAGE",
    CHANNEL_FAILED: "CHANNEL_BUSY",
    CHANNEL_NOT_IMPLEMENTED: "CHANNEL_BUSY",
    OPEN_ORDER_EXISTS: "OPEN_ORDER",
    TRUST_REQUIRED: "TRUST_REQUIRED",
};
function siteOrderNo(prefix) {
    return `${prefix}${Date.now().toString(36).toUpperCase()}${randomBytes(5).toString("hex").toUpperCase()}`.slice(0, 64);
}
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** 6.7.1: same (user, requestId) → same number; `R` marks request-derived numbers. Invalid ids fall back to random. */
export function requestOrderNo(prefix, userId, requestId) {
    if (!requestId || !REQUEST_ID.test(requestId))
        return null;
    const h = createHash("sha256").update(`${userId}\n${requestId}`).digest("hex").slice(0, 24).toUpperCase();
    return `${prefix}R${h}`.slice(0, 64);
}
function stateOf(v) {
    const state = { orderNo: v.site_order_no, status: v.status === "partial" ? "pending" : v.status, paidAt: v.paid_at };
    const ui = parsePayUi(v.ui);
    if (ui)
        state.ui = ui;
    if (v.outage === true || ui?.kind === "outage") {
        state.outage = true;
        state.ui = ui?.kind === "outage" ? ui : uiOutage();
    }
    return state;
}
/** Identity (cooldown keys) + 4.14 payer profile for the center admin; empty values dropped. Pure. */
function playerOf(input) {
    const player = { siteUserRef: input.userId };
    if (input.huiyuanId)
        player.huiyuanId = input.huiyuanId;
    if (input.phone)
        player.phone = input.phone;
    if (input.username)
        player.username = input.username;
    if (input.nickname)
        player.nickname = input.nickname;
    return player;
}
function toCenterInput(no, input) {
    const out = { siteOrderNo: no, player: playerOf(input), amountCents: input.amountCents, subject: input.subject ?? "充值" };
    if (input.clientIp)
        out.clientIp = input.clientIp;
    if (input.line)
        out.line = input.line;
    if (input.deviceFingerprint)
        out.deviceFingerprint = input.deviceFingerprint.slice(0, 128);
    if (typeof input.accountAgeSec === "number" && input.accountAgeSec >= 0)
        out.accountAgeSec = Math.floor(input.accountAgeSec);
    if (input.onOpen)
        out.onOpen = input.onOpen;
    if (input.userAgent)
        out.userAgent = input.userAgent.slice(0, 512);
    if (input.touchHint === true)
        out.touchHint = true;
    if (input.accountCreatedAt) {
        const t = new Date(input.accountCreatedAt);
        if (Number.isFinite(t.getTime()))
            out.accountCreatedAt = t.toISOString();
    }
    if (typeof input.phoneVerified === "boolean")
        out.phoneVerified = input.phoneVerified;
    if (input.challengePassed)
        out.challengePassed = true;
    return withExtras(out, input);
}
/** 6.5 PayCreateRequest extras (only the ones the site sent). */
function withExtras(out, input) {
    if (input.sessionId)
        out.sessionId = input.sessionId.slice(0, 128);
    if (typeof input.vipLevel === "number")
        out.vipLevel = input.vipLevel;
    if (typeof input.playerLevel === "number")
        out.playerLevel = input.playerLevel;
    if (typeof input.totalRechargedCents === "number")
        out.totalRechargedCents = input.totalRechargedCents;
    if (input.signals)
        out.signals = input.signals;
    return out;
}
function openOf(e) {
    const d = e.details ?? {};
    return {
        orderNo: String(d.site_order_no ?? ""),
        amountCents: Number(d.amount_cents ?? 0),
        sameSite: d.same_site === true,
        siteName: typeof d.site_name === "string" ? d.site_name : null,
        expireAt: String(d.expires_at ?? ""),
    };
}
function refusal(e) {
    const retry = Number(e.details?.retry_after_sec ?? e.details?.wait_sec);
    const code = CODE_MAP[e.code] ?? "ERROR";
    const open = code === "OPEN_ORDER" ? openOf(e) : null;
    // 4.13.1: one mapping for every refusal — QUEUED is always a queue prompt (never 「我知道了」).
    const ui = refusalPayUi(e.code, e.message, e.details ?? {});
    const base = { ok: false, code, message: e.message, ui, ...(open ? { open } : {}) };
    return Number.isFinite(retry) && retry > 0 ? { ...base, retryAfterSec: retry } : base;
}
function unpaidOf(v) {
    const u = v.unpaid;
    return u ? { today: u.today, streak: u.streak, nextWaitSec: u.next_wait_sec, leftBeforeBan: u.left_before_ban } : null;
}
function accepted(no, v) {
    if (!v.current)
        return { ok: false, code: "CHANNEL_BUSY", message: "通道繁忙，请稍后再试" };
    const expireAt = v.current.expires_at || v.expires_at;
    const unpaid = unpaidOf(v);
    const ttlSec = Math.max(0, (Date.parse(expireAt) - Date.now()) / 1000);
    return {
        ok: true,
        order: {
            orderNo: no,
            amountCents: v.amount_cents,
            payUrl: v.current.pay_url,
            checkoutUrl: v.current.checkout_url,
            payTip: v.current.pay_tip,
            linkKind: v.current.link_kind ?? null,
            jumpHint: v.current.jump_hint ?? null,
            expireAt,
            nextOrderTip: v.next_order_tip,
            sessionToken: v.session_token,
            queuedMs: v.queued_ms ?? 0,
            reused: v.reused === true,
            unpaid,
            notice: unpaidNoticeText(unpaid, ttlSec),
            ui: parsePayUi(v.ui) ?? uiPayNotice({ siteOrderNo: no, expireAt, unpaid }),
            centerOrderNo: v.order_no,
            overlayToken: v.overlay_token ?? null,
            scene: v.pay_scene ?? null,
        },
    };
}
/** hvToken → challengePassed (ok or verifier down); a bad token is dropped so the center decides (CHALLENGE_REQUIRED). */
async function withHuman(hv, input) {
    if (!input.hvToken || !hv || input.challengePassed)
        return input;
    const verdict = await redeemHumanToken(hv, input.hvToken, "pay");
    return verdict === "bad" ? input : { ...input, challengePassed: true };
}
/**
 * 6.8: center answer → result; a row saved by this call that can never be paid is handed back to the book
 * (best effort, never fails the call). A request-derived number is kept on refusal: the overlay re-submits it.
 */
async function settleCreate(book, r, no, f) {
    const drop = async (reason) => {
        if (f.fresh && book.discard)
            await book.discard(no, reason).catch(() => undefined);
    };
    if (!r.ok) {
        if (!f.fixed)
            await drop("refused");
        return refusal(r.error);
    }
    // Reused = the player's earlier order on this site (already in the book), not the number just saved.
    const reusedOther = r.value.reused === true && r.value.site_order_no !== no;
    if (reusedOther)
        await drop("reused");
    return accepted(reusedOther ? r.value.site_order_no : no, r.value);
}
export function createCenterSide(o) {
    const mine = async (userId, orderNo) => {
        const rec = await o.book.load(orderNo);
        return rec && rec.userId === userId ? rec : null;
    };
    return {
        async createOrder(input) {
            const prefix = o.orderPrefix ?? "C";
            const fixed = requestOrderNo(prefix, input.userId, input.requestId);
            const no = fixed ?? siteOrderNo(prefix);
            // Remember the order before the service knows it, so a fast notify always finds it.
            // A request-derived number already in the book (re-submit of the same pay attempt) is not saved twice.
            const known = fixed ? await o.book.load(no) : null;
            if (known && (known.userId !== input.userId || known.amountCents !== input.amountCents)) {
                return { ok: false, code: "ERROR", message: "订单信息有变，请重新下单", ui: null };
            }
            if (!known)
                await o.book.save({ siteOrderNo: no, userId: input.userId, amountCents: input.amountCents, meta: input.meta ?? {} });
            const r = await o.client.tryCreateOrder(toCenterInput(no, await withHuman(o.humanVerify, input)));
            return settleCreate(o.book, r, no, { fresh: !known, fixed: fixed !== null });
        },
        async resume(userId, orderNo) {
            if (!(await mine(userId, orderNo)))
                return { ok: false, code: "ERROR", message: "订单不存在" };
            const r = await settle(o.client.resume({ siteOrderNo: orderNo }));
            return r.ok ? accepted(orderNo, r.value) : refusal(r.error);
        },
        async check(userId, orderNo) {
            if (!(await mine(userId, orderNo)))
                return null;
            const v = await o.client.check({ siteOrderNo: orderNo });
            const st = stateOf(v);
            return st.outage ? st : { ...st, ui: parsePayUi(v.ui) ?? uiCheckResult(v.status) };
        },
        async getOrder(userId, orderNo) {
            if (!(await mine(userId, orderNo)))
                return null;
            return stateOf(await o.client.query({ siteOrderNo: orderNo }));
        },
        async cancel(userId, orderNo) {
            if (!(await mine(userId, orderNo)))
                return false;
            const r = await o.client.cancel({ siteOrderNo: orderNo }).catch(() => null);
            return r?.status === "cancelled";
        },
        rulesLines: async () => (await o.client.payRules()).lines,
        payStatus: async () => (o.client.payStatus ? o.client.payStatus() : { outage: false, ui: null }),
        async queue() {
            const q = await o.client.queue();
            return { enabled: q.enabled, waitMs: q.wait_ms, ahead: q.ahead, text: q.text };
        },
        async queuePoll(p) {
            const player = { siteUserRef: p.userId };
            if (p.huiyuanId)
                player.huiyuanId = p.huiyuanId;
            if (p.phone)
                player.phone = p.phone;
            const v = await o.client.queuePoll(player);
            const base = { ready: v.ready, position: v.position, etaMs: v.eta_ms, text: v.text };
            if (v.outage !== true)
                return base;
            const ui = parsePayUi(v.ui);
            return { ...base, ready: false, outage: true, ui: ui?.kind === "outage" ? ui : uiOutage() };
        },
    };
}
/**
 * Center notify → PaidEvent. The local record must exist, belong to the notified player and match the paid
 * amount; anything else throws, so the service keeps retrying and alerts (never auto-credit a mismatch).
 */
export function createCenterNotify(o, onPaid) {
    const handle = notifyHandler({
        appId: o.appId,
        secret: o.secret,
        ...(o.dedupe ? { dedupe: o.dedupe } : {}),
        async onPaid(n) {
            const rec = await o.book.load(n.site_order_no);
            if (!rec)
                throw new Error(`unknown site order ${n.site_order_no}`);
            if (rec.userId !== n.user_ref)
                throw new Error(`user mismatch on ${n.site_order_no}`);
            if (n.paid_cents !== rec.amountCents)
                throw new Error(`paid ${n.paid_cents} ≠ ${rec.amountCents} on ${n.site_order_no}`);
            await onPaid({
                mode: "center",
                orderNo: rec.siteOrderNo,
                idempotencyKey: rec.siteOrderNo,
                userId: rec.userId,
                amountCents: rec.amountCents,
                paidCents: n.paid_cents,
                meta: rec.meta,
                late: n.late === 1,
                paidAt: new Date(n.paid_at || Date.now()),
            });
        },
        ...(o.onRefunded ? { onRefunded: o.onRefunded } : {}),
        ...(o.onPartial ? { onPartial: o.onPartial } : {}),
    });
    return (rawBody) => handle(rawBody);
}
/** In-memory SiteOrderBook for tests and demos (not for production: lost on restart). */
export function memoryOrderBook() {
    const rows = new Map();
    const discarded = new Map();
    return {
        rows,
        discarded,
        discard: async (no, reason) => void discarded.set(no, reason),
        save: async (r) => {
            if (rows.has(r.siteOrderNo))
                throw new Error(`duplicate site order ${r.siteOrderNo}`);
            rows.set(r.siteOrderNo, structuredClone(r));
        },
        load: async (no) => structuredClone(rows.get(no) ?? null),
    };
}
