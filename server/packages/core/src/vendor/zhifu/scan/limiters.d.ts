import type { ScanLimiter } from "./gate.ts";
/**
 * Built-in `ScanLimiter`s (fixed window, true = still under the limit).
 * - `memoryScanLimiter`: one process only (tests, single-instance tools); the safe default when none is passed.
 * - `redisScanLimiter`: any ioredis-compatible client (`eval`); shared by every instance. Key prefix is the app's.
 */
export declare function memoryScanLimiter(now?: () => number): ScanLimiter & {
    size(): number;
};
/** Minimal surface of ioredis / node-redis v4 `eval` used here. */
export interface RedisEvalClient {
    eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}
export declare function redisScanLimiter(redis: RedisEvalClient, prefix: string): ScanLimiter;