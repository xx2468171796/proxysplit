/**
 * 通知接公司实时刷新 shuaxin(1.7 起,可选):宿主已经有一条 shuaxin 长连接时,通知不再自己开 SSE。
 *
 *   服务端  createTongzhi({ store, realtime: createShuaxinTongzhiRealtime({ publisher, tenantId }), invalidateOnRead: true })
 *           网关 canSubscribe 里先问 tongzhiCanSubscribe(session, ref),返回 null 再走宿主自己的判断
 *   浏览器  <TongzhiProvider push={useMemo(() => tongzhiPushSource(sharedRealtime(), userId), [userId])} />
 *
 * 模型 = 「变了 → 重新拉 bundle」:推送只带事件名,不带通知内容(内容按本人权限走 HTTP 取)。
 * 两种 ref:本人收件箱 tongzhi/inbox/<userId>(定向通知、本人已读)和全员 tongzhi/broadcast/all(全员 / 档位 / 标签 / 角色)。
 * 只用 shuaxin 的类型,运行时不 import 它:没装 shuaxin 的宿主不受影响。
 */
import type { ChangeInput, ChangePublisher, EntityRef } from "shuaxin";
import type { RealtimeClient } from "shuaxin/web";
import type { PushSource } from "../client/index.ts";
import type { TongzhiRealtimeLike } from "../service.ts";
export declare const TONGZHI_REALTIME_MODULE = "tongzhi";
/** 推送的事件名(客户端不看它,任何变化都重拉) */
export declare const TONGZHI_CHANGED_EVENT = "tongzhi.inbox.changed";
/** 定向通知一次最多发多少个人的 ref;更多就改发全员 ref(stream 每桶只留约 2000 条,别一条通知挤掉别人的变化) */
export declare const MAX_TARGETED_REFS = 100;
/** 本人收件箱 */
export declare function tongzhiInboxRef(userId: string): EntityRef;
/** 全员(本租户所有在线的人) */
export declare function tongzhiBroadcastRef(): EntityRef;
export interface TongzhiChangeOptions {
    maxTargeted?: number;
    event?: string;
}
/** 一次 invalidate(userIds) 要发的变化:定向且人不多 = 每人一条;否则一条全员 */
export declare function tongzhiChanges(tenantId: string, userIds: readonly string[] | null, o?: TongzhiChangeOptions): ChangeInput[];
/** 字符串 = 单租户站;函数 = 多租户站自己从上下文取(AsyncLocalStorage 等) */
export type TenantSource = string | (() => string | Promise<string>);
export interface ShuaxinTongzhiRealtimeOptions extends TongzhiChangeOptions {
    /** shuaxin 的 createChangePublisher(redis, prefix) */
    publisher: ChangePublisher;
    tenantId: TenantSource;
}
/** 直接传给 createTongzhi({ realtime }) 的实现:invalidate 变成 shuaxin 变化。发布失败会抛,service 那层吞掉 */
export declare function createShuaxinTongzhiRealtime(o: ShuaxinTongzhiRealtimeOptions): TongzhiRealtimeLike;
/** 迁移期两条路都发(老 SSE + shuaxin):各自失败互不影响,全部失败才抛 */
export declare function combineTongzhiRealtime(...parts: readonly TongzhiRealtimeLike[]): TongzhiRealtimeLike;
/**
 * 网关 canSubscribe 的通知部分:本人收件箱 / 全员 ref 放行,别人的收件箱拒绝;不是 tongzhi 的 ref 返回 null(交给宿主)。
 *   canSubscribe: async (s, ref) => tongzhiCanSubscribe(s, ref) ?? canRead(s, ref)
 */
export declare function tongzhiCanSubscribe(session: {
    userId: string;
}, ref: EntityRef): boolean | null;
export interface TongzhiPushOptions {
    /** 全员 ref 的变化随机错开 0–N 毫秒再重拉(一条全员公告别让所有人同一刻打 bundle),默认 2000;0 = 不错开 */
    broadcastJitterMs?: number;
    /** 测试用 */
    random?: () => number;
}
/** 给 createFeedState / TongzhiProvider 的 push:关注本人收件箱 + 全员两个 ref,变了(含 shuaxin 的 resync)就重拉 */
export declare function tongzhiPushSource(realtime: Pick<RealtimeClient, "watch">, userId: string, o?: TongzhiPushOptions): PushSource;