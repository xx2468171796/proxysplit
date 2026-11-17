import { randomBytes } from "node:crypto";
import { builtinChannelFactories } from "../channels/adapters/index.js";
import { AttemptError, openAttemptWith, qrExpiresAt, settleWith } from "../engine/index.js";
import { payerIpOf, upstreamExpiry } from "../handoff/index.js";
import { resolvePresentation, wantLink } from "../presentation/index.js";
import { checkRule, pickByMode } from "../routing/index.js";
import { gateScan, jumpPage, memoryScanLimiter, statusPage } from "../scan/index.js";
import { issueScanToken, issueSessionToken, verifyScanToken } from "../scan/tokens.js";
const orderNoOf = (now) => `P${now.toISOString().replace(/\D/g, "").slice(2, 14)}${randomBytes(4).toString("hex").toUpperCase()}`;
const page = (status, title, text) => ({ kind: "page", status, html: statusPage(title, text) });
async function usable(c, amountCents, exclude = []) {
    const out = [];
    for (const ch of await c.o.store.channels()) {
        if (!ch.enabled || exclude.includes(ch.code))
            continue;
        const adapter = c.adapterOf(ch);
        if (!adapter)
            continue;
        const facts = await c.o.store.channelFacts(ch.code, c.now());
        const reject = checkRule({ rule: ch.rule, facts, appId: "standalone", amountCents, isSplit: false, now: c.now() });
        if (!reject)
            out.push({ code: ch.code, preferred: false, adapter, channel: ch });
    }
    return out;
}
/** UTF-8 bytes of the JSON meta; unserialisable (bigint, cycles) = too big. */
function metaBytes(meta) {
    try {
        return Buffer.byteLength(JSON.stringify(meta), "utf8");
    }
    catch {
        return Number.POSITIVE_INFINITY;
    }
}
async function createOrder(c, input) {
    const k = await c.o.store.knobs();
    if (!k.collection)
        return { ok: false, code: "COLLECTION_OFF", title: "暂停充值", message: k.collectionText };
    if (input.amountCents < BigInt(k.minAmountCents) || input.amountCents > BigInt(k.maxAmountCents))
        return { ok: false, code: "AMOUNT", title: "金额不在范围内", message: "请选择其它充值金额" };
    if (input.meta && metaBytes(input.meta) > 8192)
        return { ok: false, code: "INVALID", title: "订单信息过长", message: "请重新下单" };
    if (k.outageGate && (await usable(c, input.amountCents)).length === 0)
        return { ok: false, code: "OUTAGE", title: k.outageTitle, message: k.outageBody };
    const at = c.now();
    const { order, created } = await c.o.store.insertOrder({
        orderNo: orderNoOf(at),
        merchantRef: input.merchantRef,
        playerKey: input.playerKey,
        deviceKey: input.deviceKey ?? null,
        amountCents: input.amountCents,
        returnUrl: input.returnUrl ?? null,
        clientIp: input.clientIp ?? null,
        createdAt: at,
        expiresAt: new Date(at.getTime() + k.orderTtlSec * 1000),
        meta: input.meta ?? null,
        test: input.test ?? false,
    });
    // Idempotent replay only for the same player and amount; never hand out someone else's order.
    if (!created && (order.playerKey !== input.playerKey || order.amountCents !== input.amountCents))
        return { ok: false, code: "CONFLICT", title: "订单号重复", message: "请重新下单" };
    return handOut(c, order);
}
/** QR link + session token for a live order (create and 「继续支付」 alike). */
function handOut(c, order) {
    return {
        ok: true,
        orderNo: order.orderNo,
        scanUrl: `${c.base}/s/${issueScanToken(c.o.secret, order.orderNo, order.expiresAt)}`,
        sessionToken: issueSessionToken(c.o.secret, order.orderNo, c.now()),
        expiresAt: order.expiresAt,
    };
}
function storeResult(c, order, row, pick, r) {
    if (!r.ok || !r.payUrl)
        return c.o.store.finishAttempt(row.id, { error: r.error ?? "上游未返回支付链接" });
    const expiresAt = qrExpiresAt({
        orderExpiresAt: order.expiresAt,
        upstreamExpiresAt: r.expiresAt,
        qrTtlSec: pick.channel.rule.qrTtlSec,
        now: c.now(),
    });
    return c.o.store.finishAttempt(row.id, { payUrl: r.payUrl, expiresAt });
}
/** The standalone tables behind the shared `openAttemptWith`. */
export function standaloneAttemptPort(c, order) {
    return {
        route: async (exclude) => {
            const all = await usable(c, order.amountCents, exclude);
            const picked = pickByMode("priority_failover", all.map((p) => p.channel), { random: Math.random, cursor: 0n });
            const pick = all.find((p) => p.code === picked?.code);
            if (!pick)
                throw new AttemptError("NO_CHANNEL", "暂无可用的收款通道，请稍后再试");
            return pick;
        },
        reserve: (pick) => c.o.store.reserveAttempt({
            attemptNo: `A${orderNoOf(c.now()).slice(1)}`,
            orderId: order.id,
            channelCode: pick.code,
            amountCents: order.amountCents,
            expiresAt: order.expiresAt,
        }),
        handoffSource: async (pick, row) => ({
            attemptNo: row.attemptNo,
            amountCents: order.amountCents,
            generatedSubject: null,
            orderReturnUrl: order.returnUrl,
            channelCode: pick.code,
            centerBase: c.base,
            line: null,
            isSplit: false,
            payerIp: payerIpOf({ scanToCreate: true, scanIp: order.scanIp, clientIp: order.clientIp }),
            expiresAt: upstreamExpiry({ now: c.now(), orderExpiresAt: order.expiresAt, qrTtlSec: pick.channel.rule.qrTtlSec }),
            siteTerms: c.o.siteTerms ?? [],
            // Presentation (zhifu/presentation): standalone attempts are opened only by the /s/ scan on a phone (Alipay
            // app or phone browser — the scan gate refuses desktops), so the scene is mobile; the channel rule decides.
            scene: "mobile",
            wantLink: wantLink("mobile", pick.adapter.links, resolvePresentation(null, pick.channel.rule).qrMode),
        }),
        recordCreate: (pick, ok, error) => c.o.store.recordCreate(pick.code, ok, error, c.now()),
        storeResult: (row, pick, r) => storeResult(c, order, row, pick, r),
    };
}
function closedPage(order, now) {
    if (!order)
        return page(404, "二维码已失效", "请回到页面重新下单");
    if (order.status === "paid")
        return page(200, "已支付", "这笔订单已付款，请回到页面查看");
    if (order.status !== "pending" || order.expiresAt <= now)
        return page(410, "二维码已过期", "请回到页面重新下单");
    return null;
}
const jump = (url) => ({ kind: "jump", status: 200, html: jumpPage(url) });
async function scan(c, token, client) {
    const orderNo = verifyScanToken(c.o.secret, token, c.now());
    const order = orderNo ? await c.o.store.orderByNo(orderNo) : null;
    const closed = closedPage(order, c.now());
    if (closed || !order)
        return closed ?? page(404, "二维码已失效", "请回到页面重新下单");
    const k = await c.o.store.knobs();
    const ports = { now: c.now, ipGeo: c.o.ipGeo, ipRep: c.o.ipRep };
    if (await gateScan(ports, order, { ...client, limiter: c.o.limiter ?? null }, k.scan))
        return page(403, "当前无法付款", "请使用支付宝扫码，并把手机切换到移动数据（4G / 5G）后重试");
    await c.o.store.markScanned(order.id, client.ip, c.now());
    // One upstream order per QR at a time: concurrent scans wait for the first and reuse its link.
    return c.o.store.withOrderLock(order.id, () => openOrReuse(c, { ...order, scanIp: client.ip }, k));
}
async function openOrReuse(c, order, k) {
    const live = await c.o.store.liveAttempt(order.id, c.now());
    if (live?.payUrl)
        return jump(live.payUrl);
    try {
        const row = await openAttemptWith(standaloneAttemptPort(c, order));
        return row.payUrl ? jump(row.payUrl) : page(502, k.outageTitle, k.outageBody);
    }
    catch (e) {
        if (e instanceof AttemptError)
            return page(503, k.outageTitle, k.outageBody);
        throw e;
    }
}
export function createStandalonePay(o) {
    if (o.secret.length < 32)
        throw new Error("standalone pay secret must be at least 32 characters");
    if (o.mock && !o.allowMock)
        throw new Error("standalone pay: the mock channel needs allowMock: true (tests / demo only)");
    if (o.ipGeo === undefined)
        throw new Error("standalone pay needs ipGeo (yanzheng/geo createIpGeo) or an explicit null");
    const factories = { ...builtinChannelFactories(o.mock), ...o.factories };
    const adapters = new Map();
    const adapterOf = (ch) => {
        // Keyed by the whole config: an admin edit (credentials / kind) builds a fresh adapter.
        const key = JSON.stringify([ch.code, ch.kind, ch.credentials]);
        const hit = adapters.get(key);
        if (hit)
            return hit;
        const factory = factories[ch.kind];
        if (!factory)
            return null;
        const a = factory({ code: ch.code, credentials: ch.credentials, gatewayChannelId: null });
        adapters.set(key, a);
        return a;
    };
    let limiter = o.limiter;
    if (limiter === undefined) {
        // PM2 cluster / several instances: per-process counting multiplies the caps — refuse to guess.
        if (process.env.NODE_APP_INSTANCE !== undefined)
            throw new Error("standalone pay: running as a PM2 instance — pass redisScanLimiter(redis, prefix) (or limiter: null explicitly)");
        console.warn("[zhifu/server] no scan limiter passed: using an in-process memoryScanLimiter (pass redisScanLimiter when running more than one instance)");
        limiter = memoryScanLimiter();
    }
    const c = { o: { ...o, limiter }, now: o.now ?? (() => new Date()), base: o.publicBaseUrl.replace(/\/$/, ""), adapterOf };
    return {
        createOrder: (input) => createOrder(c, input),
        scan: (token, client) => scan(c, token, client),
        /** Player cancel (only the owner, only while pending). */
        cancel: async (orderNo, playerKey) => {
            const order = await o.store.orderByNo(orderNo);
            if (!order || order.playerKey !== playerKey)
                return false;
            return o.store.cancelOrder(order.id, c.now());
        },
        /** Pre-check (5.16 `ensurePayOpen`): the outage text when the outage gate is on and no channel is usable now. */
        outage: async () => {
            const k = await o.store.knobs();
            if (!k.outageGate || (await usable(c, BigInt(k.minAmountCents))).length > 0)
                return null;
            return { title: k.outageTitle, body: k.outageBody };
        },
        /** 「继续支付」: the same order's QR again while it is pending and not expired; null otherwise / not yours. */
        resume: async (orderNo, playerKey) => {
            const order = await o.store.orderByNo(orderNo);
            if (!order || order.playerKey !== playerKey || order.status !== "pending" || order.expiresAt <= c.now())
                return null;
            return handOut(c, order);
        },
        adapterOf,
        now: c.now,
    };
}
/** The store's transaction behind the shared `settleWith`. */
export function standaloneSettlePort(tx) {
    return {
        lockTargets: async (input) => {
            const attempt = await tx.lockAttempt(input.attemptNo);
            if (!attempt || attempt.channelCode !== input.channelCode)
                return null;
            const order = await tx.lockOrder(attempt.orderId);
            if (!order)
                return null;
            // The sweeper may lag: an order past its expiry counts as expired, so its money settles as "late".
            const status = order.status === "pending" && order.expiresAt <= input.paidAt ? "expired" : order.status;
            return { attempt, order, piece: { status, amountCents: order.amountCents } };
        },
        insertFact: (input, t, status) => tx.insertPayment({
            channelCode: input.channelCode,
            attemptNo: input.attemptNo,
            upstreamTradeNo: input.upstreamTradeNo,
            orderId: t.order.id,
            amountCents: input.amountCents,
            expectedCents: t.attempt.amountCents,
            status,
            paidAt: input.paidAt,
        }),
        checkConflict: async (input) => {
            if (!input.upstreamTradeNo)
                return;
            const other = await tx.paymentByTrade(input.channelCode, input.upstreamTradeNo);
            if (other && other.attemptNo !== input.attemptNo)
                await tx.openIssue("trade_no_conflict", `${input.channelCode}:${input.upstreamTradeNo}`, { attemptNo: input.attemptNo });
        },
        closeAttempt: (a) => tx.closeAttempt(a.id),
        creditChannel: (code, paidAt, cents) => tx.creditChannel(code, paidAt, cents),
        openAnomaly: (input, t, status) => tx.openIssue(status === "review" ? "amount_mismatch" : "duplicate_payment", `${input.channelCode}:${input.attemptNo}`, {
            expected: t.attempt.amountCents.toString(),
            actual: input.amountCents.toString(),
        }),
        markPiecePaid: async (order, _piece, _late, paidAt) => {
            await tx.markOrderPaid(order.id, paidAt);
            return "paid";
        },
    };
}
/** Channel callback → verify → settle (shared) → onPaid; ack only after fulfilment succeeded. */
export async function handleStandaloneCallback(pay, o, code, body, headers) {
    const channel = (await o.store.channels()).find((c) => c.code === code);
    const adapter = channel ? pay.adapterOf(channel) : null;
    if (!adapter)
        return { status: 404, body: "unknown channel" };
    const fact = await adapter.verifyCallback({ body, headers });
    if (!fact)
        return { status: 400, body: "bad signature" };
    if (fact.kind !== "paid")
        return { status: 200, body: adapter.callbackAck };
    const result = await o.store.inSettleTx((tx) => settleWith(standaloneSettlePort(tx), {
        channelCode: code,
        attemptNo: fact.attemptNo,
        amountCents: fact.amountCents,
        upstreamTradeNo: fact.upstreamTradeNo,
        payerInfo: fact.payerInfo,
        paidAt: fact.paidAt,
        raw: fact.raw,
        source: "callback",
    }));
    const paid = result.orderNo && (result.outcome === "settled" || result.outcome === "already");
    const order = paid && result.orderNo ? await o.store.orderByNo(result.orderNo) : null;
    // Claim first: concurrent callbacks never run onPaid twice; a crash leaves a stale claim retried after 5 min.
    if (order?.status === "paid" && !order.fulfilledAt) {
        if (!(await o.store.claimFulfilment(order.id, new Date())))
            return { status: 503, body: "fulfilling" };
        try {
            await o.onPaid(order);
        }
        catch (e) {
            await o.store.releaseFulfilment(order.id);
            throw e; // no ack → the upstream retries the callback
        }
        await o.store.markFulfilled(order.id, new Date());
    }
    return { status: 200, body: adapter.callbackAck };
}
