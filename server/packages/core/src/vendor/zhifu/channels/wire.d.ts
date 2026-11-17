/**
 * Canonical form shared with the existing gateway (中转站): drop `sign`, sort keys,
 * join raw `k=v` with `&`, no URL encoding; null/undefined become empty strings.
 */
export type FlatValue = string | number | boolean | null;
export type FlatParams = Readonly<Record<string, FlatValue | undefined>>;
export declare function canonicalString(params: FlatParams): string;
export declare function signParams(params: FlatParams, secret: string): string;
/** Constant-time check against every secret (rotation: [new, old]); never exits early. */
export declare function verifySignature(params: FlatParams, signature: string, secrets: readonly string[]): boolean;
/** Parses a JSON body into a flat scalar object; nested values make signatures ambiguous → null. */
export declare function parseFlatJson(input: unknown): Record<string, FlatValue> | null;
export declare function centsToYuan(cents: bigint): string;
/** Parses a yuan value ("12.3", 12.3, "12") into cents; more than 2 decimals or junk → null. */
export declare function yuanToCents(value: unknown): bigint | null;