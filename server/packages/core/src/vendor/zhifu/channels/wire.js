/** Wire helpers shared by the adapters (copied verbatim from zhifu-service @zs/shared signing + money). */
import { createHmac, timingSafeEqual } from "node:crypto";
export function canonicalString(params) {
    return Object.keys(params)
        .filter((key) => key !== "sign" && params[key] !== undefined)
        .sort()
        .map((key) => `${key}=${params[key] ?? ""}`)
        .join("&");
}
export function signParams(params, secret) {
    return createHmac("sha256", secret).update(canonicalString(params)).digest("hex");
}
/** Constant-time check against every secret (rotation: [new, old]); never exits early. */
export function verifySignature(params, signature, secrets) {
    if (!/^[0-9a-f]{64}$/i.test(signature))
        return false;
    const actual = Buffer.from(signature.toLowerCase(), "hex");
    let matched = 0;
    for (const secret of secrets) {
        if (!secret)
            continue;
        const expected = Buffer.from(signParams(params, secret), "hex");
        matched |= Number(timingSafeEqual(expected, actual));
    }
    return matched !== 0;
}
/** Parses a JSON body into a flat scalar object; nested values make signatures ambiguous → null. */
export function parseFlatJson(input) {
    let parsed = input;
    if (typeof input === "string") {
        try {
            parsed = JSON.parse(input);
        }
        catch {
            return null;
        }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return null;
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
            return null;
        }
        out[key] = value;
    }
    return out;
}
export function centsToYuan(cents) {
    const negative = cents < 0n;
    const abs = negative ? -cents : cents;
    const yuan = abs / 100n;
    const rest = abs % 100n;
    const text = rest === 0n ? `${yuan}` : `${yuan}.${rest.toString().padStart(2, "0").replace(/0$/, "")}`;
    return negative ? `-${text}` : text;
}
/** Parses a yuan value ("12.3", 12.3, "12") into cents; more than 2 decimals or junk → null. */
export function yuanToCents(value) {
    const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
    if (typeof text !== "string")
        return null;
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
    if (!match)
        return null;
    const [, sign, whole = "0", fraction = ""] = match;
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
    return sign === "-" ? -cents : cents;
}
