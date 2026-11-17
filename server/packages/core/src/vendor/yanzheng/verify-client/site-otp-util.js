/**
 * site-otp.ts 的无状态小工具(从主文件拆出:主文件已到 500 行上限)。
 * 对外仍从 `./site-otp.ts` / `./index.ts` 导出,站点不要直接引这个文件。
 */
/** 暂存内容 `{ h: 码哈希, t: 结果票据 }`;坏了 / 形状不对一律当没有 */
export function parseStash(raw) {
    if (!raw)
        return null;
    try {
        const p = JSON.parse(raw);
        return typeof p.h === "string" && typeof p.t === "string" ? { h: p.h, t: p.t } : null;
    }
    catch {
        return null;
    }
}
/** 抹平耗时:fn 无论成败都至少花 ms 毫秒 */
export async function withMinDuration(fn, ms) {
    const start = Date.now();
    try {
        return await fn();
    }
    finally {
        const left = ms - (Date.now() - start);
        if (left > 0)
            await new Promise((r) => setTimeout(r, left));
    }
}
