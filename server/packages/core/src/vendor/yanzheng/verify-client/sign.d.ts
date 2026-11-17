export declare const sha256hex: (s: string) => string;
export declare function canonicalRequest(method: string, path: string, body: string, ts: number, nonce: string): string;
export declare function signRequest(secret: string, method: string, path: string, body: string, ts: number, nonce: string): string;
export declare const newNonce: () => string;
/** 签名头(含 Host)。`now` 毫秒 */
export declare function signedHeaders(o: {
    siteId: string;
    secret: string;
    host: string;
}, method: string, path: string, body: string, now: number): Record<string, string>;
/** 结果票据里的 `sub`:sha256(siteId|channel|规范化后的手机号或小写邮箱)。站点拿它对比「票是不是发给这个号的」 */
export declare function subjectHash(siteId: string, channel: "sms" | "email", subject: string): string;