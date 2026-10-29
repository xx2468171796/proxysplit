export const TONGZHI_REALTIME_MODULE = "tongzhi";
/** 推送的事件名(客户端不看它,任何变化都重拉) */
export const TONGZHI_CHANGED_EVENT = "tongzhi.inbox.changed";
/** 定向通知一次最多发多少个人的 ref;更多就改发全员 ref(stream 每桶只留约 2000 条,别一条通知挤掉别人的变化) */
export const MAX_TARGETED_REFS = 100;
// 与 shuaxin 网关的 ref 校验同一条规则:段里只许字母数字 . _ -,最长 100;不合规的用户 id 退回全员 ref
const segment = /^[A-Za-z0-9._-]{1,100}$/;
const usable = (userId) => segment.test(userId);
/** 本人收件箱 */
export function tongzhiInboxRef(userId) {
    return { module: TONGZHI_REALTIME_MODULE, type: "inbox", id: userId };
}
/** 全员(本租户所有在线的人) */
export function tongzhiBroadcastRef() {
    return { module: TONGZHI_REALTIME_MODULE, type: "broadcast", id: "all" };
}
/** 一次 invalidate(userIds) 要发的变化:定向且人不多 = 每人一条;否则一条全员 */
export function tongzhiChanges(tenantId, userIds, o = {}) {
    const event = o.event ?? TONGZHI_CHANGED_EVENT;
    const ids = userIds ? [...new Set(userIds)] : null;
    const targeted = ids !== null && ids.length <= (o.maxTargeted ?? MAX_TARGETED_REFS) && ids.every(usable);
    if (ids && ids.length === 0)
        return [];
    if (!targeted || !ids)
        return [{ tenantId, event, ref: tongzhiBroadcastRef() }];
    return ids.map((id) => ({ tenantId, event, ref: tongzhiInboxRef(id) }));
}
/** 直接传给 createTongzhi({ realtime }) 的实现:invalidate 变成 shuaxin 变化。发布失败会抛,service 那层吞掉 */
export function createShuaxinTongzhiRealtime(o) {
    return {
        async invalidate(userIds) {
            const tenantId = typeof o.tenantId === "string" ? o.tenantId : await o.tenantId();
            const changes = tongzhiChanges(tenantId, userIds, o);
            if (changes.length > 0)
                await o.publisher.publish(changes);
        },
    };
}
/** 迁移期两条路都发(老 SSE + shuaxin):各自失败互不影响,全部失败才抛 */
export function combineTongzhiRealtime(...parts) {
    return {
        async invalidate(userIds) {
            const results = await Promise.allSettled(parts.map((p) => p.invalidate(userIds)));
            const failed = results.filter((r) => r.status === "rejected");
            if (parts.length > 0 && failed.length === parts.length)
                throw failed[0]?.reason;
        },
    };
}
/**
 * 网关 canSubscribe 的通知部分:本人收件箱 / 全员 ref 放行,别人的收件箱拒绝;不是 tongzhi 的 ref 返回 null(交给宿主)。
 *   canSubscribe: async (s, ref) => tongzhiCanSubscribe(s, ref) ?? canRead(s, ref)
 */
export function tongzhiCanSubscribe(session, ref) {
    if (ref.module !== TONGZHI_REALTIME_MODULE)
        return null;
    if (ref.type === "inbox")
        return ref.id === session.userId;
    if (ref.type === "broadcast")
        return ref.id === "all";
    return false;
}
/** 给 createFeedState / TongzhiProvider 的 push:关注本人收件箱 + 全员两个 ref,变了(含 shuaxin 的 resync)就重拉 */
export function tongzhiPushSource(realtime, userId, o = {}) {
    return (onInvalidate) => {
        const timers = new Set();
        const jitter = Math.max(0, o.broadcastJitterMs ?? 2000);
        const later = () => {
            if (jitter === 0)
                return onInvalidate();
            const timer = setTimeout(() => {
                timers.delete(timer);
                onInvalidate();
            }, Math.floor((o.random ?? Math.random)() * jitter));
            timers.add(timer);
        };
        const stops = [realtime.watch(tongzhiBroadcastRef(), later)];
        if (usable(userId))
            stops.push(realtime.watch(tongzhiInboxRef(userId), () => onInvalidate()));
        return () => {
            for (const stop of stops)
                stop();
            for (const timer of timers)
                clearTimeout(timer);
            timers.clear();
        };
    };
}
