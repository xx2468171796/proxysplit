/** Short-lived browser token for SSE / polling of one order: "<expSec>.<hmac>". */
export declare function issueSessionToken(secret: string, orderNo: string, now: Date, ttlSec?: number): string;
export declare function verifySessionToken(secret: string, orderNo: string, token: string, now: Date): boolean;
/**
 * Scan-to-create QR token "<orderNo>.<expSec>.<hmac>" (purpose-separated from the session token, so one can
 * never be used as the other). Expiry = the order's own expiry; the order state is re-checked on every scan.
 */
export declare function issueScanToken(secret: string, orderNo: string, expiresAt: Date): string;
/** The order number when the token is genuine and unexpired, else null. */
export declare function verifyScanToken(secret: string, token: string, now: Date): string | null;