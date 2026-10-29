/**
 * 跨站推送的 HMAC 签名协议(会员中心广播台 → 各站)。与 huiyuan / cdk 同一套纪律,头名 x-tz-* 以免密钥混用。
 * 签名覆盖 method + path + timestamp + nonce + body 摘要;防重放:时间戳 ±300s + nonce 一次性(700s)。
 * 本包自带,不跨包 import。
 */
import crypto from "node:crypto";
export const TIMESTAMP_TOLERANCE_SEC = 300;
export const NONCE_TTL_SEC = 700;
export const HEADER = { timestamp: "x-tz-timestamp", nonce: "x-tz-nonce", signature: "x-tz-signature", site: "x-tz-site" };
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export function timingSafeEqualStr(a, b) {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) {
        crypto.timingSafeEqual(ba, ba);
        return false;
    }
    return crypto.timingSafeEqual(ba, bb);
}
export const randomHex = (bytes = 16) => crypto.randomBytes(bytes).toString("hex");
export const generateSecret = () => crypto.randomBytes(32).toString("base64url");
export const buildSigningString = (i) => [i.method.toUpperCase(), i.path, i.timestamp, i.nonce, sha256(i.body ?? "")].join("\n");
export const sign = (secret, i) => crypto.createHmac("sha256", secret).update(buildSigningString(i)).digest("hex");
export function buildSignedHeaders(o) {
    const timestamp = String(Math.floor((o.now ?? new Date()).getTime() / 1000));
    const nonce = randomHex(16);
    return {
        "content-type": "application/json",
        [HEADER.timestamp]: timestamp, [HEADER.nonce]: nonce, [HEADER.site]: o.site,
        [HEADER.signature]: sign(o.secret, { method: o.method, path: o.path, timestamp, nonce, body: o.body }),
    };
}
export function verifySignature(o) {
    const h = (k) => { const v = o.headers[k]; return Array.isArray(v) ? v[0] : v; };
    const timestamp = h(HEADER.timestamp);
    const nonce = h(HEADER.nonce);
    const signature = h(HEADER.signature);
    const site = h(HEADER.site) ?? "";
    if (!timestamp || !nonce || !signature)
        return { ok: false, reason: "missing_headers" };
    const ts = Number(timestamp);
    const nowSec = Math.floor((o.now ?? new Date()).getTime() / 1000);
    if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > TIMESTAMP_TOLERANCE_SEC)
        return { ok: false, reason: "timestamp_skew" };
    const expect = sign(o.secret, { method: o.method, path: o.path, timestamp, nonce, body: o.body });
    if (!timingSafeEqualStr(expect, signature))
        return { ok: false, reason: "bad_signature" };
    return { ok: true, nonce, site };
}
