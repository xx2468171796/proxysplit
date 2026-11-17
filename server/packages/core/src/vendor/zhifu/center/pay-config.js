import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sign } from "./sign.js";
function toTier(t) {
    const o = typeof t === "number" ? { amount_cents: t } : t;
    return {
        amount_cents: Number(o.amount_cents ?? 0),
        label: o.label ?? "",
        bonus_cents: Number(o.bonus_cents ?? 0),
        hot: Boolean(o.hot),
        enabled: o.enabled !== false,
    };
}
function fromLocal(appId, l) {
    const items = (l.tiers ?? []).map(toTier);
    return {
        app_id: appId,
        version: 0,
        tiers: { configured: items.length > 0, allow_custom: l.allowCustom ?? true, items },
        min_amount_cents: l.minAmountCents,
        max_amount_cents: l.maxAmountCents ?? Number.MAX_SAFE_INTEGER,
        collection: { enabled: true, text: "" },
        gate: null,
        rules_lines: [],
        server_time: new Date().toISOString(),
        source: "local",
        fetched_at: new Date().toISOString(),
    };
}
function isConfig(v) {
    if (!v || typeof v !== "object")
        return false;
    const o = v;
    const t = o.tiers;
    return typeof o.min_amount_cents === "number" && Array.isArray(t?.items) && typeof o.version === "number";
}
/** Effective tiers: central when configured there, else the site's local list (enabled ones only, in order). */
export function effectiveTiers(cfg, local) {
    const items = cfg.tiers.configured || !local ? cfg.tiers.items : (local.tiers ?? []).map(toTier);
    return items.filter((t) => t.enabled && t.amount_cents >= cfg.min_amount_cents && t.amount_cents <= cfg.max_amount_cents);
}
/** Same rule the service applies on create: null = allowed, else the player-facing reason. */
export function payAmountError(cfg, amountCents, local) {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0)
        return "金额无效";
    if (!cfg.collection.enabled)
        return cfg.collection.text || "充值维护中，请稍后再试";
    const min = cfg.min_amount_cents;
    if (amountCents < min)
        return `单笔最低 ${(min / 100).toFixed(min % 100 ? 2 : 0)} 元`;
    if (amountCents > cfg.max_amount_cents)
        return "充值金额超过单笔上限";
    const allowCustom = cfg.tiers.configured ? cfg.tiers.allow_custom : (local?.allowCustom ?? true);
    if (allowCustom)
        return null;
    return effectiveTiers(cfg, local).some((t) => t.amount_cents === amountCents) ? null : "请选择页面上的充值档位";
}
/** HMAC-SHA256(secret, "<timestamp>.<raw body>"), lowercase hex — the zhifu-service response signature. */
export function payConfigSignature(secret, timestamp, body) {
    return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}
const warnedUnsigned = new WeakSet();
/** 4.4: verify `x-zs-timestamp` / `x-zs-signature`; throws on mismatch (pull falls back to last good / local). */
export function checkResponseSignature(o, body, ts, sig, nowSec = Math.floor(Date.now() / 1000)) {
    if (!sig) {
        if (o.requireSignature)
            throw new Error("pay-config response is not signed");
        if (!warnedUnsigned.has(o)) {
            warnedUnsigned.add(o);
            o.onLog?.("zhifu payConfig: response not signed (old zhifu-service?) — accepted for now");
        }
        return;
    }
    if (!ts || !/^\d+$/.test(ts) || Math.abs(nowSec - Number(ts)) > 300)
        throw new Error("pay-config signature timestamp out of window");
    const want = Buffer.from(payConfigSignature(o.secret, ts, body), "hex");
    const got = /^[0-9a-f]{64}$/i.test(sig) ? Buffer.from(sig.toLowerCase(), "hex") : Buffer.alloc(0);
    if (got.length !== want.length || !timingSafeEqual(got, want))
        throw new Error("pay-config signature mismatch");
}
/** Pulls `GET /v1/site/pay-config` (signed query), caches it, persists the last good copy. */
export function createPayConfigSync(o) {
    const http = o.fetch ?? fetch;
    const base = o.baseUrl.replace(/\/+$/, "");
    const cacheMs = o.cacheMs ?? 30000;
    const retryMs = o.retryMs ?? 10000;
    let good = null;
    let nextAt = 0;
    let inflight = null;
    let snapshotTried = false;
    async function pull() {
        const q = {
            app_id: o.appId,
            timestamp: Math.floor(Date.now() / 1000),
            nonce: randomBytes(12).toString("hex"),
        };
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(q))
            params.set(k, String(v));
        params.set("sign", sign(q, o.secret));
        const res = await http(`${base}/v1/site/pay-config?${params}`, {
            signal: AbortSignal.timeout(o.timeoutMs ?? 5000),
        });
        const text = await res.text();
        checkResponseSignature(o, text, res.headers.get("x-zs-timestamp"), res.headers.get("x-zs-signature"));
        const data = JSON.parse(text);
        if (!res.ok || !isConfig(data))
            throw new Error(`pay-config HTTP ${res.status}`);
        return { ...data, source: "service", fetched_at: new Date().toISOString() };
    }
    async function loadSnapshot() {
        if (snapshotTried || !o.snapshotFile)
            return null;
        snapshotTried = true;
        try {
            const v = JSON.parse(await readFile(o.snapshotFile, "utf8"));
            return isConfig(v) && v.app_id === o.appId ? { ...v, source: "snapshot" } : null;
        }
        catch {
            return null;
        }
    }
    async function saveSnapshot(cfg) {
        if (!o.snapshotFile)
            return;
        try {
            await mkdir(dirname(o.snapshotFile), { recursive: true });
            const tmp = `${o.snapshotFile}.${process.pid}.tmp`;
            await writeFile(tmp, JSON.stringify(cfg));
            await rename(tmp, o.snapshotFile);
        }
        catch (e) {
            o.onLog?.("zhifu payConfig: snapshot write failed", e);
        }
    }
    async function refresh() {
        try {
            const cfg = await pull();
            const changed = !good || good.version !== cfg.version || JSON.stringify(good.gate) !== JSON.stringify(cfg.gate);
            good = cfg;
            nextAt = Date.now() + cacheMs;
            if (changed)
                await saveSnapshot(cfg);
            return cfg;
        }
        catch (e) {
            o.onLog?.("zhifu payConfig: pull failed, keeping last good / local", e);
            nextAt = Date.now() + retryMs;
            good = good ?? (await loadSnapshot());
            return good ?? fromLocal(o.appId, await o.local());
        }
    }
    async function get() {
        if (good && Date.now() < nextAt)
            return good;
        if (!good && Date.now() < nextAt) {
            good = await loadSnapshot();
            return good ?? fromLocal(o.appId, await o.local());
        }
        inflight ?? (inflight = refresh().finally(() => {
            inflight = null;
        }));
        return inflight;
    }
    return {
        get,
        /** Force a pull now (admin "立即同步", tests). */
        refresh,
        tiers: async () => effectiveTiers(await get(), await o.local()),
        checkAmount: async (amountCents) => payAmountError(await get(), amountCents, await o.local()),
        /** For `createGlobalPayControls({ settings })`: central gate JSON, or undefined → controls fall back to Redis. */
        gateSettings: async () => (await get()).gate ?? undefined,
    };
}
