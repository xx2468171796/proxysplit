import { randomBytes } from "node:crypto";
import { PayServiceError } from "./errors.js";
import { uiOpenOrder } from "./ui.js";
import { sign } from "./sign.js";
const MOCK_LINE = { id: "mock", name: "模拟线路", usable: true, reason: null, recommended: true };
const MOCK_RULES = {
    rules: { enabled: true, baseIntervalSec: 60, ladderSec: [60], banAfterUnpaid: 8 },
    lines: [],
    queue: { enabled: false, wait_ms: 0, ahead: 0, text: "" },
};
function newOrder(orderNo, input, expires) {
    return {
        order_no: orderNo,
        site_order_no: input.siteOrderNo,
        user_ref: input.player.siteUserRef,
        status: "pending",
        amount_cents: input.amountCents,
        paid_cents: 0,
        refunded_cents: 0,
        late: false,
        expires_at: expires,
        paid_at: null,
        pieces: [{ seq: 1, amount_cents: input.amountCents, status: "pending" }],
        current: {
            attempt_no: `${orderNo}A1`,
            channel: "mock",
            pay_url: `https://mock.pay/${orderNo}`,
            checkout_url: null,
            pay_tip: null,
            expires_at: expires,
            line: input.line ?? null,
            line_honored: true,
        },
        next_order_tip: null,
        session_token: `mock-${orderNo}`,
        overlay_token: `1999999999.mock-${orderNo}`,
        pay_scene: "unknown",
        queued_ms: 0,
        queue_full: false,
        pay_banned: false,
        reused: false,
        unpaid: { today: 0, streak: 0, next_wait_sec: 60, left_before_ban: 8 },
    };
}
/**
 * In-memory stand-in for zhifu-service in site tests: same surface as `createPayClient`, plus `pay()` which
 * returns a correctly signed notify body to feed into your own notify route. No network, no timers.
 */
export function createMockCenter(opts) {
    const now = opts.now ?? (() => new Date());
    const byNo = new Map();
    const byKey = new Map();
    let seq = 0;
    const find = (ref) => {
        const no = "orderNo" in ref ? ref.orderNo : [...byNo.values()].find((o) => o.site_order_no === ref.siteOrderNo)?.order_no;
        const o = no ? byNo.get(no) : undefined;
        if (!o)
            throw new PayServiceError("NOT_FOUND", "订单不存在", 404);
        return o;
    };
    const openOf = (userRef) => [...byNo.values()].find((o) => o.user_ref === userRef && o.status === "pending" && Date.parse(o.expires_at) > now().getTime());
    const view = ({ user_ref: _u, ...o }) => structuredClone(o);
    /** Force the next createOrder to fail with this code (e.g. "COOLDOWN"), once. */
    let nextError = null;
    const createOrder = async (input) => {
        if (nextError) {
            const e = nextError;
            nextError = null;
            throw e;
        }
        const key = input.idempotencyKey ?? input.siteOrderNo;
        const existing = byKey.get(key);
        if (existing)
            return view(find({ orderNo: existing }));
        const open = opts.singleOpen === false ? undefined : openOf(input.player.siteUserRef);
        if (open && input.onOpen === "cancel")
            open.status = "cancelled";
        else if (open && open.amount_cents === input.amountCents)
            return { ...view(open), reused: true };
        else if (open) {
            throw new PayServiceError("OPEN_ORDER_EXISTS", "你有一笔未支付的订单，请先完成支付或取消后再下单", 409, {
                order_no: open.order_no,
                site_order_no: open.site_order_no,
                amount_cents: open.amount_cents,
                same_site: true,
                site_name: null,
                expires_at: open.expires_at,
                ui: uiOpenOrder({ siteOrderNo: open.site_order_no, amountCents: open.amount_cents, sameSite: true, siteName: null }),
            });
        }
        const orderNo = `M${++seq}`;
        const expires = new Date(now().getTime() + 15 * 60000).toISOString();
        const o = newOrder(orderNo, input, expires);
        byNo.set(orderNo, o);
        byKey.set(key, orderNo);
        return view(o);
    };
    const client = {
        createOrder,
        tryCreateOrder: async (input) => {
            try {
                return { ok: true, value: await createOrder(input) };
            }
            catch (error) {
                return { ok: false, error: error };
            }
        },
        query: async (ref) => view(find(ref)),
        cancel: async (ref) => {
            const o = find(ref);
            if (o.status === "pending")
                o.status = "cancelled";
            return view(o);
        },
        resume: async (ref) => view(find(ref)),
        check: async (ref) => view(find(ref)),
        lines: async () => ({ lines: [MOCK_LINE] }),
        payRules: async () => structuredClone(MOCK_RULES),
        queue: async () => structuredClone(MOCK_RULES.queue),
        queuePoll: async () => ({ ready: true, position: 0, eta_ms: 0, text: "" }),
        payStatus: async () => ({ outage: false, ui: null }),
        refund: async (input) => {
            const o = find({ orderNo: input.orderNo });
            o.refunded_cents += input.amountCents;
            return { refund_no: input.refundNo, status: "succeeded", amount_cents: input.amountCents };
        },
    };
    /** Mark paid and return the signed `order.paid` body the service would POST to your notify url. */
    function pay(orderNo) {
        const o = find({ orderNo });
        Object.assign(o, { status: "paid", paid_cents: o.amount_cents, paid_at: now().toISOString() });
        return paidBody(opts, o, now());
    }
    return {
        client,
        pay,
        /** Make the next createOrder fail with this code once (e.g. "COOLDOWN", "QUEUE_FULL", "PAY_BANNED"). */
        failNext: (code, message = code, details) => {
            nextError = new PayServiceError(code, message, 429, details);
        },
    };
}
function paidBody(opts, o, at) {
    const body = {
        app_id: opts.appId,
        event: "order.paid",
        notify_id: `N${o.order_no}`,
        order_no: o.order_no,
        site_order_no: o.site_order_no,
        user_ref: o.user_ref,
        amount_cents: o.amount_cents,
        paid_cents: o.paid_cents,
        refunded_cents: o.refunded_cents,
        status: "paid",
        late: 0,
        paid_at: o.paid_at ?? at.toISOString(),
        timestamp: Math.floor(at.getTime() / 1000),
        nonce: randomBytes(8).toString("hex"),
    };
    return JSON.stringify({ ...body, sign: sign(body, opts.secret) });
}
