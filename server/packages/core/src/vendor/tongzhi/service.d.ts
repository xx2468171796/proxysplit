import { newBatchId, phaseOf } from "./core/logic.ts";
import { type NoticeTemplate } from "./core/templates.ts";
import type { TongzhiStore } from "./store/types.ts";
import { type Audience, type FeedItem, type FeedPage, type FeedQuery, type Notice, type NoticeInput, type NoticeListFilter, type NoticeListPage, type NoticePatch, type NoticePhase, type NoticeStats, type PlayerContext, type SendInput } from "./types.ts";
export interface TongzhiRealtimeLike {
    /** 通知这些人(null = 所有人)「你的通知集变了,重新拉」 */
    invalidate(userIds: string[] | null): void | Promise<void>;
}
export interface Actor {
    /** 真人管理员 id 或 `ai:<name>`;业务代码发送用 `system` */
    id: string;
    source?: string;
}
export interface TongzhiOptions {
    store: TongzhiStore;
    realtime?: TongzhiRealtimeLike | null;
    now?: () => Date;
    newId?: () => string;
    /** 「今天」按哪个时区切(分钟);默认 480 = UTC+8 */
    tzOffsetMin?: number;
    /** 追加/覆盖模板(按 key) */
    templates?: NoticeTemplate[];
    /** 估算受众人数(preview 用);不给就 null。全员 / 档位 / 标签 / 角色都交给宿主算 */
    countAudience?: (audience: Audience) => Promise<number | null>;
    /**
     * 玩家标已读 / 全部已读 / 归档后也通知本人(1.7 起,默认 false):同一个人的别的标签页 / 设备的未读数跟着变。
     * 接 shuaxin 推送(tongzhi/shuaxin)时建议开;老 SSE 也认,但只有主标签页连着,收益小。
     */
    invalidateOnRead?: boolean;
    /** 发布 / 撤回 / 发送 后的钩子(审计、日志);抛错不影响主流程 */
    onEvent?: (e: TongzhiEvent) => void | Promise<void>;
}
export type TongzhiEvent = {
    type: "created";
    notice: Notice;
    actor: Actor;
} | {
    type: "updated";
    notice: Notice;
    actor: Actor;
} | {
    type: "published";
    notice: Notice;
    actor: Actor;
} | {
    type: "revoked";
    notice: Notice;
    actor: Actor;
} | {
    type: "batch_revoked";
    batchId: string;
    count: number;
    actor: Actor;
} | {
    type: "sent";
    notice: Notice;
    userIds: string[];
    actor: Actor;
} | {
    type: "removed";
    noticeId: string;
    actor: Actor;
} | {
    type: "purged";
    count: number;
    before: Date;
    actor: Actor;
};
export interface Bundle {
    unread: number;
    inbox: FeedItem[];
    popups: FeedItem[];
    marquee: FeedItem[];
    banners: FeedItem[];
    /** 定向 toast:最近 windowMs 内到达且未 seen 的收件箱条目 */
    toasts: FeedItem[];
}
export interface PreviewResult {
    notice: Omit<Notice, "id" | "createdAt" | "updatedAt" | "publishedAt" | "revokedAt" | "status" | "source" | "createdBy">;
    summary: string;
    phaseIfPublishedNow: ReturnType<typeof phaseOf>;
    audienceCount: number | null;
    warnings: string[];
}
export declare function createTongzhi(opts: TongzhiOptions): {
    create: (input: NoticeInput, actor: Actor, opt?: {
        publish?: boolean;
    }) => Promise<Notice>;
    update: (id: string, patch: NoticePatch, actor: Actor) => Promise<Notice>;
    publish: (id: string, actor: Actor) => Promise<Notice>;
    revoke: (id: string, actor: Actor) => Promise<Notice>;
    revokeBatch: (batchId: string, actor: Actor, opt?: {
        source?: string;
    }) => Promise<number>;
    remove: (id: string, actor: Actor) => Promise<boolean>;
    send: (input: SendInput, actor?: Actor) => Promise<Notice>;
    preview: (input: NoticeInput) => Promise<PreviewResult>;
    get: (id: string) => Promise<Notice>;
    list: (filter?: NoticeListFilter) => Promise<NoticeListPage>;
    stats: (id: string) => Promise<NoticeStats>;
    countByPhase: () => Promise<{
        counts: Record<NoticePhase, number>;
        exact: boolean;
    }>;
    purge: (opt?: {
        olderThanDays?: number;
    }, actor?: Actor) => Promise<{
        count: number;
        before: Date;
    }>;
    bundle: (ctx: PlayerContext, opt?: {
        inboxLimit?: number;
        toastWindowMs?: number;
    }) => Promise<Bundle>;
    feed: (ctx: PlayerContext, q?: FeedQuery) => Promise<FeedPage>;
    unreadCount: (ctx: PlayerContext) => Promise<number>;
    markSeen: (userId: string, ids: string[]) => Promise<void>;
    markRead: (userId: string, ids: string[]) => Promise<void>;
    markAllRead: (ctx: PlayerContext) => Promise<number>;
    archive: (userId: string, ids: string[]) => Promise<void>;
    dismiss: (userId: string, id: string, opt?: {
        hours?: number;
    }) => Promise<Date>;
    popupShown: (userId: string, id: string) => Promise<void>;
    templates: () => NoticeTemplate[];
    fromTemplate: (key: string, vars?: Record<string, string>) => NoticeInput;
    newBatchId: typeof newBatchId;
    now: () => Date;
};
export type Tongzhi = ReturnType<typeof createTongzhi>;
export declare function nextLocalMidnight(t: Date, tzOffsetMin: number): Date;