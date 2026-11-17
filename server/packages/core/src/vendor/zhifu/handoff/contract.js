import { subjectViolations } from "./policy.js";
/** Leaf values of a parsed JSON value, nested objects / arrays and JSON-in-string (business_params) expanded.
 * A string that is itself a JSON object / array is replaced by its leaves (the raw container text would make a
 * center URL inside it look like a leaked word). */
function leaves(v, out) {
    if (v !== null && typeof v === "object") {
        for (const x of Object.values(v))
            leaves(x, out);
        return;
    }
    const s = String(v);
    if (s.startsWith("{") || s.startsWith("[")) {
        try {
            const parsed = JSON.parse(s);
            if (parsed !== null && typeof parsed === "object") {
                leaves(parsed, out);
                return;
            }
        }
        catch {
            // not JSON: keep the string itself
        }
    }
    out.push(s);
}
/** Every leaf value of a JSON text (deep). */
export function jsonValues(text) {
    const out = [];
    leaves(JSON.parse(text), out);
    return out;
}
function valuesOf(body) {
    if (body instanceof URLSearchParams) {
        const out = [];
        for (const v of body.values())
            leaves(v, out);
        return out;
    }
    const text = String(body ?? "");
    try {
        return jsonValues(text);
    }
    catch {
        return [text];
    }
}
/** A signature / key blob: ≥ 40 chars of standard base64 or hex only (no `_` / `-`: slug-style ids stay checked). */
const SIGNATURE_LIKE = /^(?:[A-Za-z0-9+/]{40,}={0,2}|[0-9a-f]{40,})$/i;
const urlOf = (u) => (u instanceof Request ? u.url : String(u));
let capturing = false;
const FAKE_UPSTREAM_BODY = JSON.stringify({
    code: "000001",
    data: { pay_info: JSON.stringify({ pay_url: "https://pay.test/x", sys_order_id: "S1" }), qr_code: "https://qr" },
});
/**
 * Calls `adapter.create(input)` with `globalThis.fetch` swapped for a recorder (restored afterwards).
 * `apiHost` = the channel API host: a signed pay URL on it (browser-side APIs) counts as wire too.
 * `extraValues` = values an in-process adapter (mock) recorded itself. Sequential only: a second concurrent
 * capture throws. Adapters must call upstream through global `fetch` (undici / node:https would be invisible —
 * an empty wire fails the notify / subject checks).
 */
export async function captureHandoffWire(adapter, input, opts = {}) {
    if (capturing)
        throw new Error("captureHandoffWire: already capturing (run contract checks sequentially)");
    capturing = true;
    const wire = { urls: [], values: [] };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
        wire.urls.push(urlOf(url));
        wire.values.push(...valuesOf(init?.body));
        return opts.respond ? opts.respond() : new Response(FAKE_UPSTREAM_BODY);
    });
    try {
        const result = await adapter.create(input);
        if (result.payUrl && opts.apiHost && new URL(result.payUrl).hostname === opts.apiHost) {
            const url = new URL(result.payUrl);
            wire.urls.push(`${url.origin}${url.pathname}`);
            for (const [, v] of url.searchParams)
                leaves(v, wire.values);
        }
        if (opts.extraValues)
            wire.values.push(...opts.extraValues());
    }
    finally {
        globalThis.fetch = realFetch;
        capturing = false;
    }
    return wire;
}
function originOf(u) {
    try {
        return new URL(u).origin;
    }
    catch {
        return null;
    }
}
/** Wire-level leaks: foreign hosts, game words, loopback IP, non-center URLs. */
function leakProblems(c) {
    const out = [];
    const { input, wire } = c;
    if (c.apiHost)
        for (const u of wire.urls)
            if (new URL(u).hostname !== c.apiHost)
                out.push(`调用了通道 API 以外的地址：${u}`);
    if (!wire.values.includes(input.notifyUrl))
        out.push("notify_url 没有原样发给上游");
    if (!wire.values.includes(input.subject))
        out.push("商品描述没有原样发给上游");
    // Signatures / keys (long base64 / hex blobs) can contain any letters by chance ("csgo" in an RSA sign): skip.
    const text = wire.values.filter((v) => !v.startsWith("http") && !SIGNATURE_LIKE.test(v));
    const leaked = subjectViolations(text.join(" "));
    if (leaked.length)
        out.push(`适配器自己加了敏感词：${leaked.join("、")}`);
    if (wire.values.join("\n").includes("127.0.0.1"))
        out.push("发了 127.0.0.1");
    for (const u of wire.values.filter((v) => /^https?:\/\//.test(v)))
        if (originOf(u) !== originOf(c.centerBase))
            out.push(`发给上游的地址不在支付中心域名：${u}`);
    return out;
}
/** The adapter's `handoff` declaration must match what actually went out. */
function declarationProblems(c) {
    const out = [];
    const { input } = c;
    const all = c.wire.values.join("\n");
    const h = c.adapter.handoff;
    if (all.includes(input.clientIp ?? "-") !== (h.clientIp === "sent"))
        out.push(`clientIp 声明 ${h.clientIp} 与实际不符`);
    const unix = String(Math.floor(input.expiresAt.getTime() / 1000));
    const sentExpiry = [unix, input.expiresAt.toISOString(), ...(c.expiryTexts ?? [])].some((t) => all.includes(t));
    if (sentExpiry !== (h.expiry === "sent"))
        out.push(`expiry 声明 ${h.expiry} 与实际不符`);
    if (all.includes(input.returnUrl ?? "-") !== (h.returnUrl === "sent"))
        out.push(`returnUrl 声明 ${h.returnUrl} 与实际不符`);
    return out;
}
/** Problems of one captured create call; [] = the adapter honours the hand-off standard and its declaration. */
export function checkHandoffWire(c) {
    return [...leakProblems(c), ...declarationProblems(c)];
}
