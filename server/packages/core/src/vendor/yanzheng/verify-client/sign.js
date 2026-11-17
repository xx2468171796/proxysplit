/**
 * leichiwaf-verify 请求签名合同(与 leichiwaf `edge/hv/sign.mjs` 一字不差,改一边必须改另一边):
 *
 *   canonical = METHOD \n path(含 query) \n sha256hex(body) \n ts(unix 秒) \n nonce
 *   x-lcv-sign = hex(HMAC-SHA256(secret, canonical))
 *
 * 服务端 ±60 秒、nonce 130 秒内去重、Host 必须是该站登记的域名。
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
export const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
export function canonicalRequest(method, path, body, ts, nonce) {
    return [method.toUpperCase(), path, sha256hex(body), String(ts), nonce].join("\n");
}
export function signRequest(secret, method, path, body, ts, nonce) {
    return createHmac("sha256", secret).update(canonicalRequest(method, path, body, ts, nonce)).digest("hex");
}
export const newNonce = () => randomBytes(16).toString("base64url");
/** 签名头(含 Host)。`now` 毫秒 */
export function signedHeaders(o, method, path, body, now) {
    const ts = Math.floor(now / 1000);
    const nonce = newNonce();
    return {
        host: o.host,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        "x-lcv-site": o.siteId,
        "x-lcv-ts": String(ts),
        "x-lcv-nonce": nonce,
        "x-lcv-sign": signRequest(o.secret, method, path, body, ts, nonce),
    };
}
/** 结果票据里的 `sub`:sha256(siteId|channel|规范化后的手机号或小写邮箱)。站点拿它对比「票是不是发给这个号的」 */
export function subjectHash(siteId, channel, subject) {
    const s = channel === "sms" ? subject.replace(/[\s-]/g, "").replace(/^(\+?86)/, "") : subject.trim().toLowerCase();
    return sha256hex(`${siteId}|${channel}|${s}`);
}
