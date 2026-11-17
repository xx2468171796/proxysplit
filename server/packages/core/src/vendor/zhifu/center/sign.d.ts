/**
 * Same canonical form as the service and the 中转站 gateway: drop `sign`, sort keys,
 * raw `k=v` joined by `&`, no URL encoding. Mirrors zhifu-service packages/shared/src/signing.ts;
 * test/center.test.ts pins the vectors.
 */
export type Flat = Record<string, string | number | boolean | null | undefined>;
export declare function canonical(params: Flat): string;
export declare function sign(params: Flat, secret: string): string;
export declare function verify(params: Flat, signature: string, secret: string): boolean;