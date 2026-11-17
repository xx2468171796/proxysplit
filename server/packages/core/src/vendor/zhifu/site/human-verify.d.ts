export interface HumanVerifyOptions {
    /** The site's public host the tokens are bound to, e.g. "gx.zygskins.cn". */
    host: string;
    /** Verification service base URL; default the sz local service. */
    url?: string;
    /** Test seam only. Never pass the global fetch here: it cannot send a custom Host (see the file header). */
    fetch?: typeof fetch;
    timeoutMs?: number;
}
export type HumanVerdict = "ok" | "bad" | "unavailable";
export declare const DEFAULT_HV_URL = "http://127.0.0.1:8976";
/** Redeem a one-time token (direct local call; the service refuses traffic that came through the edge). */
export declare function redeemHumanToken(o: HumanVerifyOptions, token: string, action?: string): Promise<HumanVerdict>;