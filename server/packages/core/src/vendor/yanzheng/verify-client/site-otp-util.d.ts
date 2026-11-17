/**
 * site-otp.ts 的无状态小工具(从主文件拆出:主文件已到 500 行上限)。
 * 对外仍从 `./site-otp.ts` / `./index.ts` 导出,站点不要直接引这个文件。
 */
/** 暂存内容 `{ h: 码哈希, t: 结果票据 }`;坏了 / 形状不对一律当没有 */
export declare function parseStash(raw: string | null): {
    h: string;
    t: string;
} | null;
/** 抹平耗时:fn 无论成败都至少花 ms 毫秒 */
export declare function withMinDuration<T>(fn: () => Promise<T>, ms: number): Promise<T>;