import { signParams, verifySignature } from "../wire.js";
export class MockUpstream {
    constructor(secret = "mock-secret") {
        this.orders = new Map();
        this.failNextCreates = 0;
        /** Error text of the scripted failures (e.g. a timeout, to drive the health "timeouts" signal). */
        this.failMessage = "mock upstream failure";
        /** Next creates THROW instead of returning ok:false (adapter bugs / crashes). */
        this.throwNextCreates = 0;
        this.queryUnavailable = false;
        /** Scripted refund outcomes (FIFO); empty = succeeded. */
        this.refundResults = [];
        /** Scripted refund-query outcomes by refund_no; missing = null (unknown). */
        this.refundQueryResults = new Map();
        /** Clock for upstream expiry stamps (tests inject the harness clock). */
        this.now = () => new Date();
        this.seq = 0;
        this.secret = secret;
    }
    record(input) {
        this.seq += 1;
        const state = {
            amountCents: input.amountCents,
            status: "pending",
            tradeNo: `MOCKTRADE${this.seq}`,
            input,
        };
        this.orders.set(input.attemptNo, state);
        return state;
    }
    /** Simulates the payer paying (optionally a different amount). */
    pay(attemptNo, amountCents, at = new Date()) {
        const state = this.orders.get(attemptNo);
        if (!state)
            throw new Error(`mock: unknown attempt ${attemptNo}`);
        state.status = "paid";
        state.paidAt = at;
        if (amountCents !== undefined)
            state.amountCents = amountCents;
        return state;
    }
    /** A signed callback body as the upstream would POST it. */
    callbackBody(attemptNo) {
        const state = this.orders.get(attemptNo);
        if (!state)
            throw new Error(`mock: unknown attempt ${attemptNo}`);
        const params = {
            attempt_no: attemptNo,
            status: state.status.toUpperCase(),
            amount_cents: state.amountCents.toString(),
            trade_no: state.tradeNo,
            paid_at: (state.paidAt ?? new Date()).toISOString(),
        };
        return JSON.stringify({ ...params, sign: signParams(params, this.secret) });
    }
}
export function mockChannel(upstream) {
    return {
        kind: "mock",
        callbackAck: "success",
        // The mock keeps the whole CreateInput (`orders.get(no).input`), so tests can assert every hand-off field.
        handoff: { clientIp: "sent", expiry: "sent", returnUrl: "sent" },
        links: ["h5"],
        async create(input) {
            if (upstream.throwNextCreates > 0) {
                upstream.throwNextCreates -= 1;
                throw new Error("mock adapter crashed");
            }
            if (upstream.failNextCreates > 0) {
                upstream.failNextCreates -= 1;
                return { ok: false, error: upstream.failMessage };
            }
            const state = upstream.record(input);
            return {
                ok: true,
                channelOrderNo: state.tradeNo,
                payUrl: `https://mock.pay/qr/${input.attemptNo}`,
                linkKind: "h5",
                payTip: "测试通道",
                expiresAt: new Date(upstream.now().getTime() + 10 * 60000),
                ...(input.line ? { line: input.line } : {}),
            };
        },
        async query(attemptNo) {
            if (upstream.queryUnavailable)
                return null;
            const state = upstream.orders.get(attemptNo);
            if (!state)
                return null;
            return {
                status: state.status,
                amountCents: state.amountCents,
                upstreamTradeNo: state.tradeNo,
                ...(state.paidAt ? { paidAt: state.paidAt } : {}),
            };
        },
        async verifyCallback({ body }) {
            let data;
            try {
                data = JSON.parse(body);
            }
            catch {
                return null;
            }
            const { sign, ...params } = data;
            if (typeof sign !== "string" || !verifySignature(params, sign, [upstream.secret]))
                return null;
            const attemptNo = params.attempt_no ?? null;
            if (params.status !== "PAID" || !attemptNo || !params.amount_cents)
                return { kind: "other", attemptNo };
            return {
                kind: "paid",
                attemptNo,
                amountCents: BigInt(params.amount_cents),
                upstreamTradeNo: params.trade_no ?? null,
                payerInfo: null,
                paidAt: params.paid_at ? new Date(params.paid_at) : new Date(),
                raw: params,
            };
        },
        async refund() {
            const status = upstream.refundResults.shift() ?? "succeeded";
            return status === "failed" ? { status, error: "mock refund refused" } : { status };
        },
        async queryRefund(input) {
            const status = upstream.refundQueryResults.get(input.refundNo);
            if (!status)
                return null;
            return status === "failed" ? { status, error: "mock refund refused" } : { status };
        },
        async listLines() {
            return [{ id: "mock-1", name: "测试线路", usable: true, reason: null, recommended: true }];
        },
    };
}
