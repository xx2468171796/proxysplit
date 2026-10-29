export declare const TIMESTAMP_TOLERANCE_SEC = 300;
export declare const NONCE_TTL_SEC = 700;
export declare const HEADER: {
    readonly timestamp: "x-tz-timestamp";
    readonly nonce: "x-tz-nonce";
    readonly signature: "x-tz-signature";
    readonly site: "x-tz-site";
};
export declare const sha256: (s: string) => string;
export declare function timingSafeEqualStr(a: string, b: string): boolean;
export declare const randomHex: (bytes?: number) => string;
export declare const generateSecret: () => string;
export interface SignInput {
    method: string;
    path: string;
    timestamp: string;
    nonce: string;
    body: string;
}
export declare const buildSigningString: (i: SignInput) => string;
export declare const sign: (secret: string, i: SignInput) => string;
export declare function buildSignedHeaders(o: {
    secret: string;
    site: string;
    method: string;
    path: string;
    body: string;
    now?: Date;
}): Record<string, string>;
export type VerifyFailure = "missing_headers" | "timestamp_skew" | "bad_signature";
export declare function verifySignature(o: {
    secret: string;
    method: string;
    path: string;
    body: string;
    headers: Record<string, string | string[] | undefined>;
    now?: Date;
}): {
    ok: true;
    nonce: string;
    site: string;
} | {
    ok: false;
    reason: VerifyFailure;
};