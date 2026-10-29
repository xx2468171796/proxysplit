/**
 * 内存版 KvLike —— 测试与单进程演示用。
 * **生产必须换 Redis**:PM2 cluster 下每个 worker 各有一份内存,
 * 表现是「在 A worker 登出了,请求落到 B worker 还在线」,而且不报错。
 *
 * TTL 按惰性过期实现(读的时候才判):没有后台定时器,进程退出干干净净。
 */
export function createMemoryKv(opts = {}) {
    const now = opts.now ?? (() => new Date());
    const map = new Map();
    const alive = (key) => {
        const e = map.get(key);
        if (!e)
            return undefined;
        if (e.expireAt !== undefined && now().getTime() >= e.expireAt) {
            map.delete(key);
            return undefined;
        }
        return e;
    };
    const ttlToAt = (ttlSec) => ttlSec === undefined ? undefined : now().getTime() + ttlSec * 1000;
    return {
        async get(key) {
            return alive(key)?.value ?? null;
        },
        async set(key, value, ttlSec) {
            map.set(key, { value, expireAt: ttlToAt(ttlSec) });
        },
        async setNx(key, value, ttlSec) {
            if (alive(key))
                return false;
            map.set(key, { value, expireAt: ttlToAt(ttlSec) });
            return true;
        },
        async del(key) {
            map.delete(key);
        },
        async sadd(key, member) {
            const e = alive(key);
            if (e?.set)
                e.set.add(member);
            else
                map.set(key, { set: new Set([member]) });
        },
        async srem(key, member) {
            alive(key)?.set?.delete(member);
        },
        async smembers(key) {
            return [...(alive(key)?.set ?? [])];
        },
        async expire(key, ttlSec) {
            const e = alive(key);
            if (e)
                e.expireAt = ttlToAt(ttlSec);
        },
        size() {
            let n = 0;
            for (const k of [...map.keys()])
                if (alive(k))
                    n += 1;
            return n;
        },
        clear() {
            map.clear();
        },
    };
}
