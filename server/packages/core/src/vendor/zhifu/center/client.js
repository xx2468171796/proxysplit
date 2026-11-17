import { randomBytes } from "node:crypto";
import { errorFromBody, PayServiceError, settle } from "./errors.js";
import { sign } from "./sign.js";
import { parsePayUi, uiOutage } from "./ui.js";
import { API_VERSION, SDK_VERSION } from "./version.js";
export { PayServiceError } from "./errors.js";
function refFields(ref) {
    return "orderNo" in ref ? { order_no: ref.orderNo } : { site_order_no: ref.siteOrderNo };
}
/** 5.16 pay pre-check: one shared read per ~5 s per process; any failure = open (never blocks paying on a glitch). */
function statusReader(http, url, headers, ttlMs) {
    let at = 0;
    let snap = null;
    const open = { outage: false, ui: null };
    // A failed / bad read is "open" for 1 s (not the full TTL, not zero): no 1.5 s stall on every click while the center is down.
    const failed = () => {
        at = Date.now() - ttlMs + 1000;
        return open;
    };
    const read = async () => {
        try {
            const res = await http(url, { headers, signal: AbortSignal.timeout(1500) });
            const data = (await res.json().catch(() => null));
            if (!res.ok || !data)
                return failed();
            if (data.outage !== true)
                return open;
            const ui = parsePayUi(data.ui);
            return { outage: true, ui: ui?.kind === "outage" ? ui : uiOutage() };
        }
        catch {
            return failed();
        }
    };
    return () => {
        const t = Date.now();
        if (!snap || t - at >= ttlMs) {
            at = t;
            snap = read();
        }
        return snap;
    };
}
/** Flat signed body of POST /v1/orders/create. */
function createBody(input) {
    return {
        site_order_no: input.siteOrderNo,
        idempotency_key: input.idempotencyKey ?? input.siteOrderNo,
        user_ref: input.player.siteUserRef,
        huiyuan_id: input.player.huiyuanId,
        phone: input.player.phone,
        payer_username: input.player.username?.slice(0, 64),
        payer_nickname: input.player.nickname?.slice(0, 64),
        amount_cents: input.amountCents,
        subject: input.subject,
        client_ip: input.clientIp,
        line: input.line,
        return_url: input.returnUrl,
        device_fp: input.deviceFingerprint,
        account_age_sec: input.accountAgeSec,
        on_open: input.onOpen,
        user_agent: input.userAgent?.slice(0, 512),
        touch_hint: input.touchHint === true ? 1 : undefined,
        account_created_at: input.accountCreatedAt,
        phone_verified: input.phoneVerified === undefined ? undefined : input.phoneVerified ? 1 : 0,
        // 4.10: the site verified its own slider for this player just now (signed attestation).
        challenge_passed: input.challengePassed ? 1 : undefined,
        session_id: input.sessionId?.slice(0, 128),
        vip_level: input.vipLevel,
        player_level: input.playerLevel,
        total_recharged_cents: input.totalRechargedCents,
        signals: input.signals ? JSON.stringify(input.signals) : undefined,
        // Tells the service this SDK understands `reused` (older SDKs get OPEN_ORDER_EXISTS instead).
        reuse_ok: 1,
    };
}
/** Thin signed client for the unified payment service (site backend → service). */
export function createPayClient(options) {
    const http = options.fetch ?? fetch;
    const base = options.baseUrl.replace(/\/+$/, "");
    const headers = { "content-type": "application/json", "x-zhifu-sdk": SDK_VERSION, "x-zhifu-api": API_VERSION };
    const retries = options.retries ?? 2;
    const backoff = options.backoffMs ?? 300;
    async function once(url, init) {
        let res;
        try {
            res = await http(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? 40000) });
        }
        catch (e) {
            const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
            throw new PayServiceError(timeout ? "TIMEOUT" : "NETWORK", String(e), 0);
        }
        const data = (await res.json().catch(() => null));
        if (!res.ok || !data)
            throw errorFromBody(data ?? {}, res.status, res.statusText);
        return data;
    }
    /** Retries re-sign (fresh timestamp + nonce); the business key (idempotency key / order ref) is unchanged. */
    async function withRetry(run) {
        for (let i = 0;; i++) {
            try {
                return (await run());
            }
            catch (e) {
                if (!(e instanceof PayServiceError) || !e.retryable || i >= retries)
                    throw e;
                await new Promise((r) => setTimeout(r, backoff * 2 ** i * (0.5 + Math.random())));
            }
        }
    }
    function signed(fields) {
        const body = {
            ...fields,
            app_id: options.appId,
            timestamp: Math.floor(Date.now() / 1000),
            nonce: randomBytes(12).toString("hex"),
        };
        return { ...body, sign: sign(body, options.secret) };
    }
    const call = (path, fields) => withRetry(() => once(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(signed(fields)) }));
    const createOrder = (input) => call("/v1/orders/create", createBody(input));
    const payStatus = statusReader(http, `${base}/v1/pay-status?app_id=${encodeURIComponent(options.appId)}`, headers, options.statusTtlMs ?? 5000);
    const payRules = () => withRetry(() => once(`${base}/v1/pay-rules`, { headers }));
    return {
        /** Creates (or idempotently replays) an order. Throws PayServiceError: COOLDOWN / QUEUE_FULL / PAY_BANNED / … */
        createOrder,
        /** Same as createOrder but never throws a service error: `{ ok, value } | { ok: false, error }`. */
        tryCreateOrder: (input) => settle(createOrder(input)),
        query: (ref) => call("/v1/orders/query", refFields(ref)),
        cancel: (ref) => call("/v1/orders/cancel", refFields(ref)),
        /** Resume (new QR for the same order) or switch line; never counts as a new order. */
        resume: (ref, line) => call("/v1/orders/resume", { ...refFields(ref), line }),
        /** 4.6 「我已支付」: asks the channel right now (rate-limited per order by the service), returns the order. */
        check: (ref) => call("/v1/orders/check", refFields(ref)),
        lines: (amountCents) => call("/v1/orders/lines", { amount_cents: amountCents }),
        /**
         * 5.16 pay pre-check (unsigned, no rate-limit count): `{ outage, ui }`. Call it FIRST when the player clicks pay,
         * before 支付须知 / slider / queue (INTEGRATION §21.4). Cached ~5 s in-process; network error → open.
         */
        payStatus,
        /** Unsigned public read (rules + pre-pay dialog lines + queue); cache it a few seconds on the site. */
        payRules,
        /** 4.8 fair queue: the waiting player's place / ETA, `ready` = go create now (a pass is held for 20 s). */
        queuePoll: (player) => call("/v1/queue/poll", {
            user_ref: player.siteUserRef,
            huiyuan_id: player.huiyuanId,
            phone: player.phone,
        }),
        /** Global queue status only (from payRules). */
        queue: async () => (await payRules()).queue,
        refund: (input) => call("/v1/refunds/create", {
            order_no: input.orderNo,
            refund_no: input.refundNo,
            amount_cents: input.amountCents,
            reason: input.reason,
        }),
    };
}
