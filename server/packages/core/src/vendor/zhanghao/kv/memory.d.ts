/**
 * 内存版 KvLike —— 测试与单进程演示用。
 * **生产必须换 Redis**:PM2 cluster 下每个 worker 各有一份内存,
 * 表现是「在 A worker 登出了,请求落到 B worker 还在线」,而且不报错。
 *
 * TTL 按惰性过期实现(读的时候才判):没有后台定时器,进程退出干干净净。
 */
import type { KvLike } from "../ports.ts";
export interface MemoryKv extends KvLike {
    /** 测试用:当前存活键数 */
    size(): number;
    clear(): void;
}
export declare function createMemoryKv(opts?: {
    now?: () => Date;
}): MemoryKv;