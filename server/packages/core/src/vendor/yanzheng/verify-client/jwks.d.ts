export declare const ISSUER = "leichiwaf-verify";
export interface TicketPayload {
    iss: string;
    aud: string;
    typ: "captcha" | "otp";
    iat: number;
    exp: number;
    jti: string;
    sub?: string;
    action?: string;
    purpose?: string;
    channel?: "sms" | "email";
    host?: string;
}
export type JwksFetcher = () => Promise<unknown>;
export declare function createJwksVerifier(fetchJwks: JwksFetcher, now: () => number): {
    verifyToken: (token: string, audience: string) => Promise<TicketPayload | null>;
};