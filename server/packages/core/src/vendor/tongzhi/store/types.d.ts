/**
 * 存储契约。包自带 memory(测试)与 sql-pg(任何 PG 宿主:pg / postgres.js / Prisma $queryRawUnsafe / Drizzle);
 * 宿主也可自己实现这 16 个方法。
 *
 * 三条约定:
 *   1. 受众裁决**在 store 里做一半**:users 型靠 notice_delivery 索引;tiers/tags/roles 型用 ctx 里的值和
 *      audience_values 求交集(SQL 里 `&&`);all 型直接放行。service 不再二次裁决。
 *   2. 回执 upsert 语义:`touchReceipt` 只写传进来的字段,没传的保持原值;popupCount 自增用 `bumpPopup`。
 *   3. 时间由 service 传入(now),store 不自己取 Date.now(),测试才可复现。
 */
import type { FeedItem, FeedQuery, Notice, NoticeListFilter, NoticePhase, NoticeReceipt, NoticeStats, PlayerContext } from "../types.ts";
export interface ReceiptPatch {
    seenAt?: Date | null;
    readAt?: Date | null;
    archivedAt?: Date | null;
    dismissedUntil?: Date | null;
}
export interface TongzhiStore {
    insertNotice(n: Notice): Promise<void>;
    updateNotice(id: string, patch: Partial<Notice>): Promise<Notice | null>;
    getNotice(id: string): Promise<Notice | null>;
    findByIdemKey(idemKey: string): Promise<Notice | null>;
    listNotices(filter: NoticeListFilter, now: Date): Promise<{
        items: Notice[];
        nextCursor: string | null;
    }>;
    deleteNotice(id: string): Promise<boolean>;
    /** 整批改状态(撤回批次),返回影响条数 */
    updateBatchStatus(batchId: string, patch: Pick<Notice, "status" | "revokedAt" | "updatedAt">, onlySource?: string): Promise<number>;
    insertDeliveries(rows: {
        noticeId: string;
        userId: string;
        payload: Record<string, unknown> | null;
        createdAt: Date;
    }[]): Promise<void>;
    /** 受众改成 users 型时,把不在名单里的旧投递删掉(否则被移出的人继续可见) */
    pruneDeliveries(noticeId: string, keepUserIds: string[]): Promise<number>;
    /** 玩家侧 feed:已裁决受众 + 生效窗口 + surface + 未读/归档过滤,带本人回执与 payload */
    listFeed(ctx: PlayerContext, q: FeedQuery, now: Date): Promise<{
        items: FeedItem[];
        nextCursor: string | null;
    }>;
    /** 收件箱未读数(surface=inbox, 未读且未归档) */
    countUnread(ctx: PlayerContext, now: Date): Promise<number>;
    getReceipt(noticeId: string, userId: string): Promise<NoticeReceipt | null>;
    /** 多条一起写同一份 patch(标已读 / 已看 / 归档) */
    touchReceipts(userId: string, noticeIds: string[], patch: ReceiptPatch): Promise<void>;
    /** 本人所有「当前可见且未读」的收件箱条目标已读;返回条数 */
    markAllRead(ctx: PlayerContext, now: Date): Promise<number>;
    /** popupCount+1, lastPopupAt=now */
    bumpPopup(noticeId: string, userId: string, now: Date): Promise<void>;
    stats(noticeId: string): Promise<NoticeStats>;
    /** 清理:删除 endAt 早于 before 或 revokedAt 早于 before 的通知(级联回执/投递);返回条数 */
    purge(before: Date): Promise<number>;
    /** 各阶段条数(一次聚合);不实现时 status 接口回落到「每阶段最多数 100 条」并标 countsExact=false */
    countByPhase?(now: Date): Promise<Record<NoticePhase, number>>;
    /** 原子写入「通知 + 定向投递」(同一条语句 / 同一事务);不实现时分两步写,靠幂等重试补齐投递 */
    insertNoticeWithDeliveries?(n: Notice, userIds: string[]): Promise<void>;
    /** 原子替换定向投递:补齐 userIds 里缺的、删掉不在名单里的;不实现时 insertDeliveries + pruneDeliveries 两步 */
    replaceDeliveries?(noticeId: string, userIds: string[], createdAt: Date): Promise<void>;
}