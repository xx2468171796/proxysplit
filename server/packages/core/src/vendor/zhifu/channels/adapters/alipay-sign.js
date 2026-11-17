import { createHash, createPrivateKey, createPublicKey, createSign, createVerify, X509Certificate, } from "node:crypto";
/**
 * Alipay OpenAPI (v1 gateway.do) RSA2 signing primitives, ported from the 中转站 `alipay-adapter.ts` that ran
 * merchant 宣时龙 (gw-4, cert mode) in production 2026-09 → 10. All functions are pure (given keys).
 * Sign text = every param except `sign` (requests) / `sign` + `sign_type` (notifies), non-empty, sorted by key,
 * `k=v` joined with `&`, raw values (no URL encoding), UTF-8, SHA256withRSA, base64.
 */
/** Request sign text: all params except `sign`, sorted. */
export function requestSignText(params) {
    return Object.keys(params)
        .filter((k) => k !== "sign" && params[k] !== "")
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join("&");
}
/** Notify sign text: all params except `sign` / `sign_type`, non-empty, sorted. */
export function notifySignText(params) {
    return Object.keys(params)
        .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== "")
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join("&");
}
export function rsa2Sign(text, key) {
    return createSign("RSA-SHA256").update(text, "utf8").sign(key, "base64");
}
export function rsa2Verify(text, sign, key) {
    try {
        return createVerify("RSA-SHA256").update(text, "utf8").verify(key, sign, "base64");
    }
    catch {
        return false;
    }
}
const PEM_BODY = /-----[A-Z ]+-----|\s/g;
/** App private key: PEM (PKCS#8 / PKCS#1) or the bare base64 Alipay's key tool prints (PKCS#8, else PKCS#1). */
export function loadPrivateKey(text) {
    if (text.includes("-----BEGIN"))
        return createPrivateKey(text);
    const der = Buffer.from(text.replace(PEM_BODY, ""), "base64");
    try {
        return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    }
    catch {
        return createPrivateKey({ key: der, format: "der", type: "pkcs1" });
    }
}
/** Alipay public key: PEM or the bare base64 SPKI shown in the open platform (public-key mode). */
export function loadPublicKey(text) {
    if (text.includes("-----BEGIN"))
        return createPublicKey(text);
    return createPublicKey({ key: Buffer.from(text.replace(PEM_BODY, ""), "base64"), format: "der", type: "spki" });
}
/**
 * Certificate SN = md5(issuer DN reversed, comma-joined + decimal serial). Wrong order or counting the SM2 root
 * certs → isv.invalid-alipay-root-cert-sn (learned on gw-4).
 */
export function certSn(pem) {
    const x = new X509Certificate(pem);
    const issuer = x.issuer.split("\n").reverse().join(",");
    const serial = BigInt(`0x${x.serialNumber}`).toString(10);
    return createHash("md5")
        .update(issuer + serial, "utf8")
        .digest("hex");
}
/** Root cert SN: only the RSA certs of the bundle, joined with `_`. */
export function rootCertSn(pem) {
    const certs = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    return certs
        .filter((c) => new X509Certificate(c).publicKey.asymmetricKeyType === "rsa")
        .map(certSn)
        .join("_");
}
/** Merchant PID (2088 + 12 digits) from the app cert subject CN; null for a self-signed / test cert. */
export function pidOfAppCert(pem) {
    const cn = /(?:^|\n)CN=(2088\d{12})(?:\n|$)/.exec(new X509Certificate(pem).subject);
    return cn?.[1] ?? null;
}
/** Date → "yyyy-MM-dd HH:mm:ss" Beijing time (what Alipay wants for timestamp / time_expire). */
export function beijingText(at) {
    const d = new Date(at.getTime() + 8 * 3600000).toISOString();
    return `${d.slice(0, 10)} ${d.slice(11, 19)}`;
}
/** "yyyy-MM-dd HH:mm:ss" Beijing → Date; empty / bad → null. */
export function fromBeijingText(text) {
    if (!text)
        return null;
    const at = new Date(`${text.trim().replace(" ", "T")}+08:00`);
    return Number.isFinite(at.getTime()) ? at : null;
}
/**
 * The raw JSON text of `"<key>": {...}` inside a gateway reply (the response sign covers exactly this text, so it
 * must not be re-serialised). Scans braces outside strings. null = not found / unbalanced.
 */
export function responseNodeText(body, key) {
    const at = body.indexOf(`"${key}"`);
    const start = at < 0 ? -1 : body.indexOf("{", at + key.length + 2);
    if (start < 0)
        return null;
    const end = matchingBrace(body, start);
    return end < 0 ? null : body.slice(start, end + 1);
}
/** Index of the `}` closing the `{` at `start` (braces inside JSON strings skipped); -1 = unbalanced. */
function matchingBrace(body, start) {
    let depth = 0;
    for (let i = start; i < body.length; i += 1) {
        const ch = body[i];
        if (ch === '"')
            i = stringEnd(body, i);
        else if (ch === "{")
            depth += 1;
        else if (ch === "}" && --depth === 0)
            return i;
    }
    return -1;
}
/** Index of the quote closing the JSON string opened at `open`. */
function stringEnd(body, open) {
    for (let i = open + 1; i < body.length; i += 1) {
        if (body[i] === "\\")
            i += 1;
        else if (body[i] === '"')
            return i;
    }
    return body.length;
}
