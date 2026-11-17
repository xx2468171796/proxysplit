export declare const MAX_RESPONSE_BYTES: number;
export interface RawResponse {
    status: number;
    text: string;
}
export declare function send(baseUrl: string, method: "GET" | "POST", path: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number, maxBytes?: number): Promise<RawResponse>;
export declare function parseObject(text: string): Record<string, unknown> | null;