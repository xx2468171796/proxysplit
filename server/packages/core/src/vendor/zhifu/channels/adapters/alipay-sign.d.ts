import { type KeyObject } from "node:crypto";
/**
 * Alipay OpenAPI (v1 gateway.do) RSA2 signing primitives, ported from the 中转站 `alipay-adapter.ts` that ran
 * merchant 宣时龙 (gw-4, cert mode) in production 2026-09 → 10. All functions are pure (given keys).
 * Sign text = every param except `sign` (requests) / `sign` + `sign_type` (notifies), non-empty, sorted by key,
 * `k=v` joined with `&`, raw values (no URL encoding), UTF-8, SHA256withRSA, base64.
 */
/** Request sign text: all params except `sign`, sorted. */
export declare function requestSignText(params: Readonly<Record<string, string>>): string;
/** Notify sign text: all params except `sign` / `sign_type`, non-empty, sorted. */
export declare function notifySignText(params: Readonly<Record<string, string>>): string;
export declare function rsa2Sign(text: string, key: KeyObject): string;
export declare function rsa2Verify(text: string, sign: string, key: KeyObject): boolean;
/** App private key: PEM (PKCS#8 / PKCS#1) or the bare base64 Alipay's key tool prints (PKCS#8, else PKCS#1). */
export declare function loadPrivateKey(text: string): KeyObject;
/** Alipay public key: PEM or the bare base64 SPKI shown in the open platform (public-key mode). */
export declare function loadPublicKey(text: string): KeyObject;
/**
 * Certificate SN = md5(issuer DN reversed, comma-joined + decimal serial). Wrong order or counting the SM2 root
 * certs → isv.invalid-alipay-root-cert-sn (learned on gw-4).
 */
export declare function certSn(pem: string): string;
/** Root cert SN: only the RSA certs of the bundle, joined with `_`. */
export declare function rootCertSn(pem: string): string;
/** Merchant PID (2088 + 12 digits) from the app cert subject CN; null for a self-signed / test cert. */
export declare function pidOfAppCert(pem: string): string | null;
/** Date → "yyyy-MM-dd HH:mm:ss" Beijing time (what Alipay wants for timestamp / time_expire). */
export declare function beijingText(at: Date): string;
/** "yyyy-MM-dd HH:mm:ss" Beijing → Date; empty / bad → null. */
export declare function fromBeijingText(text: string | undefined): Date | null;
/**
 * The raw JSON text of `"<key>": {...}` inside a gateway reply (the response sign covers exactly this text, so it
 * must not be re-serialised). Scans braces outside strings. null = not found / unbalanced.
 */
export declare function responseNodeText(body: string, key: string): string | null;