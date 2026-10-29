/**
 * 可选实时层:Redis Pub/Sub → 本进程 SSE 连接扇出。事件只有一种「invalidate」= 你的通知集变了,重新拉 bundle。
 * Pub/Sub 不是事实存储,丢了由轮询兜底;不做重试不做持久化(与 liaotian hub 同一条纪律)。
 *
 *   const rt = createTongzhiRealtime({ publisher: redis, subscriber: redis.duplicate(), channel: "5ff:tz" });
 *   createTongzhi({ store, realtime: rt });
 *   // Next.js: export const GET = (req) => rt.sseResponse(userId, req.signal)
 * 不接 Redis 的单进程站:createTongzhiRealtime({ local: true }) —— 进程内直发。
 */
export interface PublisherLike {
    publish(channel: string, payload: string): Promise<unknown> | unknown;
}
export interface SubscriberLike {
    subscribe(channel: string, ...rest: unknown[]): Promise<unknown> | unknown;
    on(event: "message", listener: (channel: string, payload: string) => void): unknown;
}
export interface SseClient {
    userId: string;
    write(chunk: string): boolean;
    end(): void;
}
export interface TongzhiRealtimeOptions {
    publisher?: PublisherLike;
    subscriber?: SubscriberLike;
    channel?: string;
    /** 单进程直发(无 Redis) */
    local?: boolean;
    heartbeatMs?: number;
    maxConnectionsPerUser?: number;
    maxConnections?: number;
}
export declare function createTongzhiRealtime(o?: TongzhiRealtimeOptions): {
    invalidate: (userIds: string[] | null) => Promise<void>;
    add: (c: SseClient) => void;
    remove: (c: SseClient) => void;
    close: () => void;
    sseResponse: (userId: string, signal?: AbortSignal) => Response;
    size: () => number;
    channel: string;
};
export type TongzhiRealtime = ReturnType<typeof createTongzhiRealtime>;