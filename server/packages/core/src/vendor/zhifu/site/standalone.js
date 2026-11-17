import { randomBytes } from "node:crypto";
import { uiOutage } from "../center/ui.js";
import { createStandalonePay, handleStandaloneCallback } from "../server/service.js";
import { startStandaloneJobs } from "../server/jobs.js";
const FAIL = {
    COLLECTION_OFF: "COLLECTION_OFF",
    OUTAGE: "OUTAGE",
    AMOUNT: "AMOUNT_INVALID",
    CONFLICT: "ERROR",
    INVALID: "ERROR",
};
export function eventOf(order) {
    const paidAt = order.paidAt ?? new Date();
    return {
        mode: "standalone",
        orderNo: order.orderNo,
        idempotencyKey: order.orderNo,
        userId: order.playerKey,
        amountCents: Number(order.amountCents),
        // Standalone settles only exact amounts (a mismatch goes to review, never to onPaid).
        paidCents: Number(order.amountCents),
        meta: order.meta ?? {},
        // Late = paid after the QR expired (a cancelled-then-paid order still credits; `late` is display only).
        late: paidAt > order.expiresAt,
        paidAt,
    };
}
function accepted(r, amountCents) {
    if (!r.ok) {
        const out = { ok: false, code: FAIL[r.code], message: r.message };
        return r.code === "OUTAGE" ? { ...out, ui: uiOutage({ title: r.title, body: r.message }) } : out;
    }
    return {
        ok: true,
        order: {
            orderNo: r.orderNo,
            amountCents,
            // The QR encodes our own `/s/` link: the scan gate runs before any upstream order exists.
            payUrl: r.scanUrl,
            checkoutUrl: null,
            payTip: null,
            linkKind: null,
            jumpHint: null,
            expireAt: r.expiresAt.toISOString(),
            nextOrderTip: null,
            sessionToken: r.sessionToken,
            queuedMs: 0,
            reused: false,
            unpaid: null,
            notice: null,
            ui: null,
        },
    };
}
export function createStandaloneSide(o, onPaid) {
    const jobs = o.jobs === false ? null : startStandaloneJobs(o.store, o.jobs ?? {});
    const full = { ...o, onPaid: (order) => onPaid(eventOf(order)) };
    const core = createStandalonePay(full);
    const mine = async (userId, orderNo) => {
        const order = await o.store.orderByNo(orderNo);
        return order && order.playerKey === userId ? order : null;
    };
    const state = async (userId, orderNo) => {
        const order = await mine(userId, orderNo);
        if (!order)
            return null;
        // The sweeper may lag: past expiry reads as expired.
        const status = order.status === "pending" && order.expiresAt <= core.now() ? "expired" : order.status;
        return { orderNo, status, paidAt: order.paidAt?.toISOString() ?? null };
    };
    return {
        createOrder: async (input) => accepted(await core.createOrder({
            merchantRef: `S${Date.now().toString(36)}${randomBytes(6).toString("hex")}`,
            playerKey: input.userId,
            deviceKey: input.deviceFingerprint?.slice(0, 128) ?? null,
            amountCents: BigInt(input.amountCents),
            clientIp: input.clientIp ?? null,
            meta: input.meta ?? null,
        }), input.amountCents),
        getOrder: state,
        check: state,
        cancel: (userId, orderNo) => core.cancel(orderNo, userId),
        resume: async (userId, orderNo) => {
            const r = await core.resume(orderNo, userId);
            const order = r ? await mine(userId, orderNo) : null;
            if (!r || !order)
                return { ok: false, code: "ERROR", message: "订单已失效，请重新下单" };
            const out = accepted(r, Number(order.amountCents));
            return out.ok ? { ok: true, order: { ...out.order, reused: true } } : out;
        },
        rulesLines: async () => [],
        payStatus: async () => {
            const down = await core.outage().catch(() => null); // error = open (same as the center pre-check)
            return down ? { outage: true, ui: uiOutage(down) } : { outage: false, ui: null };
        },
        queue: async () => ({ enabled: false, waitMs: 0, ahead: 0, text: "" }),
        queuePoll: async () => ({ ready: true, position: 0, etaMs: 0, text: "" }),
        stop: () => jobs?.stop(),
        embedded: {
            scan: (token, client) => core.scan(token, client),
            callback: (code, body, headers) => handleStandaloneCallback(core, full, code, body, headers),
        },
    };
}
