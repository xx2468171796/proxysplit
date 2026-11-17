/**
 * zhifu/site — `createSitePay({ mode, ... })` returns the same `SitePay` in both modes (AI-START.md).
 *
 *   const pay = createSitePay({
 *     mode: env.PAY_MODE,                       // "center" (default for new sites) | "standalone"
 *     onPaid: (e) => credit(e.idempotencyKey, e.userId, e.amountCents, e.meta),
 *     local: () => ({ minAmountCents: 100, tiers: [1000, 5000] }),
 *     center: { appId, secret, client: createPayClient({ appId, secret, baseUrl }), book },
 *     standalone: { store, publicBaseUrl, secret, ipGeo, limiter },   // 6.0: zhifu/server pipeline; mount pay.embedded
 *   });
 *
 * Configure both sides while switching: new orders go to `mode`, notifies from either side still credit.
 */
import { createPayClient } from "../center/client.js";
import { createPayConfigSync } from "../center/pay-config.js";
import { createCenterNotify, createCenterSide } from "./center.js";
import { createStandaloneSide } from "./standalone.js";
export { memoryOrderBook, requestOrderNo } from "./center.js";
export { siteStartResult } from "./overlay-start.js";
export { DEFAULT_HV_URL, redeemHumanToken } from "./human-verify.js";
function localOnly(local) {
    // A sync pointed nowhere never succeeds and falls back to `local` without throwing.
    const sync = createPayConfigSync({
        appId: "local",
        secret: "local",
        baseUrl: "http://127.0.0.1:9",
        local,
        snapshotFile: null,
        retryMs: 3600000,
        fetch: async () => {
            throw new Error("pay-config: local only");
        },
    });
    return sync;
}
function configSource(o) {
    if (o.payConfig)
        return o.payConfig;
    const c = o.center;
    if (!c?.baseUrl)
        return localOnly(o.local);
    return createPayConfigSync({
        appId: c.appId,
        secret: c.secret,
        baseUrl: c.baseUrl,
        local: o.local,
        snapshotFile: c.snapshotFile ?? null,
        ...(o.onLog ? { onLog: o.onLog } : {}),
    });
}
export function createSitePay(o) {
    if (o.mode !== "center" && o.mode !== "standalone")
        throw new Error(`zhifu/site: unknown mode ${String(o.mode)}`);
    const standalone = o.standalone ? createStandaloneSide(o.standalone, o.onPaid) : null;
    const centerSide = o.center ? createCenterSide(o.center) : null;
    const centerNotify = o.center ? createCenterNotify(o.center, o.onPaid) : null;
    const active = o.mode === "center" ? centerSide : standalone;
    if (!active)
        throw new Error(`zhifu/site: mode "${o.mode}" needs the "${o.mode}" options`);
    const cfg = configSource(o);
    const sources = centerNotify ? ["center"] : [];
    // 6.0: standalone callbacks are per channel (`embedded.callback(code, body, headers)`), not "gateway" notifies.
    async function handleNotify(source, rawBody) {
        if (source === "center" && centerNotify)
            return centerNotify(rawBody);
        return { status: 404, body: JSON.stringify({ code: 1, message: `notify source ${source} not configured` }) };
    }
    return {
        mode: o.mode,
        async createOrder(input) {
            const reason = await cfg.checkAmount(input.amountCents);
            if (reason)
                return { ok: false, code: "AMOUNT_INVALID", message: reason };
            return active.createOrder(input);
        },
        getOrder: (userId, orderNo) => active.getOrder(userId, orderNo),
        cancel: (userId, orderNo) => active.cancel(userId, orderNo),
        resume: (userId, orderNo) => active.resume(userId, orderNo),
        check: (userId, orderNo) => active.check(userId, orderNo),
        payConfig: () => cfg.get(),
        tiers: () => cfg.tiers(),
        checkAmount: (amountCents) => cfg.checkAmount(amountCents),
        rulesLines: () => active.rulesLines(),
        queue: () => active.queue(),
        queuePoll: (p) => active.queuePoll(p),
        payStatus: () => active.payStatus(),
        handleNotify,
        notifySources: sources,
        embedded: standalone?.embedded ?? null,
        stop: () => standalone?.stop(),
    };
}
export function payModeFromEnv(env) {
    const m = env.PAY_MODE?.trim();
    if (m === "center" || m === "standalone")
        return m;
    if (m)
        throw new Error(`PAY_MODE must be "center" or "standalone", got "${m}"`);
    return env.PAY_CENTER_APP_ID ? "center" : "standalone";
}
/**
 * Env-driven wiring: switching mode = change PAY_MODE + restart. Center credentials (when present) are always
 * wired, so center notifies keep crediting after a switch back to standalone; `standalone` is built only when
 * given (pass it lazily when the mode is standalone or while migrating).
 */
export function createSitePayFromEnv(env, deps) {
    const mode = payModeFromEnv(env);
    const { book, centerExtras, ...rest } = deps;
    const creds = env.PAY_CENTER_URL && env.PAY_CENTER_APP_ID && env.PAY_CENTER_SECRET;
    if (mode === "center" && (!creds || !book)) {
        throw new Error("PAY_MODE=center needs PAY_CENTER_URL / PAY_CENTER_APP_ID / PAY_CENTER_SECRET and a SiteOrderBook");
    }
    const center = creds && book && env.PAY_CENTER_URL && env.PAY_CENTER_APP_ID && env.PAY_CENTER_SECRET
        ? {
            ...centerExtras,
            ...(env.PAY_HV_HOST && !centerExtras?.humanVerify
                ? { humanVerify: { host: env.PAY_HV_HOST, ...(env.PAY_HV_URL ? { url: env.PAY_HV_URL } : {}) } }
                : {}),
            appId: env.PAY_CENTER_APP_ID,
            secret: env.PAY_CENTER_SECRET,
            baseUrl: env.PAY_CENTER_URL,
            book,
            client: createPayClient({
                appId: env.PAY_CENTER_APP_ID,
                secret: env.PAY_CENTER_SECRET,
                baseUrl: env.PAY_CENTER_URL,
            }),
        }
        : undefined;
    return createSitePay({ ...rest, mode, ...(center ? { center } : {}) });
}
