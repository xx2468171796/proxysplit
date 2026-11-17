/** `zhifu/scan/tokens` — signed `/s/` scan tokens and order session tokens (node:crypto; server side only). */
import { createHmac, timingSafeEqual } from "node:crypto";
function mac(secret, message) {
    return createHmac("sha256", secret).update(message).digest("base64url");
}
function same(a, b) {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}
/** Short-lived browser token for SSE / polling of one order: "<expSec>.<hmac>". */
export function issueSessionToken(secret, orderNo, now, ttlSec = 1800) {
    const exp = Math.floor(now.getTime() / 1000) + ttlSec;
    return `${exp}.${mac(secret, `${orderNo}.${exp}`)}`;
}
export function verifySessionToken(secret, orderNo, token, now) {
    const [expText, sig] = token.split(".", 2);
    const exp = Number(expText);
    if (!sig || !Number.isInteger(exp) || exp * 1000 < now.getTime())
        return false;
    return same(mac(secret, `${orderNo}.${exp}`), sig);
}
/** Scan tokens carry 128 bits of HMAC (22 base64url chars) to keep the QR small. */
const SCAN_SIG_LEN = 22;
/**
 * Scan-to-create QR token "<orderNo>.<expSec>.<hmac>" (purpose-separated from the session token, so one can
 * never be used as the other). Expiry = the order's own expiry; the order state is re-checked on every scan.
 */
export function issueScanToken(secret, orderNo, expiresAt) {
    const exp = Math.ceil(expiresAt.getTime() / 1000);
    return `${orderNo}.${exp}.${mac(secret, `scan:${orderNo}.${exp}`).slice(0, SCAN_SIG_LEN)}`;
}
/** The order number when the token is genuine and unexpired, else null. */
export function verifyScanToken(secret, token, now) {
    const parts = token.split(".");
    if (parts.length !== 3)
        return null;
    const [orderNo = "", expText = "", sig = ""] = parts;
    const exp = Number(expText);
    if (!orderNo || !Number.isInteger(exp) || exp * 1000 < now.getTime())
        return null;
    return same(mac(secret, `scan:${orderNo}.${exp}`).slice(0, SCAN_SIG_LEN), sig) ? orderNo : null;
}
