/**
 * Built-in `ScanLimiter`s (fixed window, true = still under the limit).
 * - `memoryScanLimiter`: one process only (tests, single-instance tools); the safe default when none is passed.
 * - `redisScanLimiter`: any ioredis-compatible client (`eval`); shared by every instance. Key prefix is the app's.
 */
export function memoryScanLimiter(now = Date.now) {
    const hits = new Map();
    let sweptAt = 0;
    const sweep = (t) => {
        if (t - sweptAt < 60000)
            return;
        sweptAt = t;
        for (const [k, v] of hits)
            if (v.until <= t)
                hits.delete(k);
    };
    return {
        hit: async (key, limit, windowMs) => {
            const t = now();
            sweep(t);
            const cur = hits.get(key);
            const slot = cur && cur.until > t ? cur : { n: 0, until: t + windowMs };
            slot.n += 1;
            hits.set(key, slot);
            return slot.n <= limit;
        },
        size: () => hits.size,
    };
}
const INCR_WINDOW = "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return n";
export function redisScanLimiter(redis, prefix) {
    if (!prefix)
        throw new Error("redisScanLimiter needs a key prefix (shared Redis: never write bare keys)");
    return {
        hit: async (key, limit, windowMs) => {
            const n = Number(await redis.eval(INCR_WINDOW, 1, `${prefix}${key}`, windowMs));
            return n <= limit;
        },
    };
}
