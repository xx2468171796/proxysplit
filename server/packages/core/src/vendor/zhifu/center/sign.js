import { createHmac, timingSafeEqual } from "node:crypto";
export function canonical(params) {
    return Object.keys(params)
        .filter((k) => k !== "sign" && params[k] !== undefined)
        .sort()
        .map((k) => `${k}=${params[k] ?? ""}`)
        .join("&");
}
export function sign(params, secret) {
    return createHmac("sha256", secret).update(canonical(params)).digest("hex");
}
export function verify(params, signature, secret) {
    if (!/^[0-9a-f]{64}$/i.test(signature))
        return false;
    return timingSafeEqual(Buffer.from(sign(params, secret), "hex"), Buffer.from(signature.toLowerCase(), "hex"));
}
