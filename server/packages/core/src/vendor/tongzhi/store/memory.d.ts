import type { FeedItem, FeedQuery, Notice, NoticeListFilter, NoticePhase, NoticeReceipt, NoticeStats, PlayerContext } from "../types.ts";
import type { ReceiptPatch, TongzhiStore } from "./types.ts";
export declare class MemoryTongzhiStore implements TongzhiStore {
    #private;
    readonly notices: Map<string, Notice>;
    readonly deliveries: Map<string, {
        payload: Record<string, unknown> | null;
        createdAt: Date;
    }>;
    readonly receipts: Map<string, NoticeReceipt>;
    insertNotice(n: Notice): Promise<void>;
    updateNotice(id: string, patch: Partial<Notice>): Promise<{
        id: string;
        kind: import("../types.ts").NoticeKind;
        severity: import("../types.ts").Severity;
        surfaces: import("../types.ts").Surface[];
        title: string;
        body: string;
        cover: string | null;
        icon: string | null;
        actions: import("../types.ts").NoticeAction[];
        audience: import("../types.ts").Audience;
        startAt: Date | null;
        endAt: Date | null;
        pinned: boolean;
        sortOrder: number;
        frequency: import("../types.ts").FrequencyMode;
        frequencyHours: number;
        maxPopups: number;
        forceRead: boolean;
        closable: boolean;
        status: import("../types.ts").NoticeStatus;
        idemKey: string | null;
        batchId: string | null;
        source: string;
        createdBy: string;
        meta: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
        publishedAt: Date | null;
        revokedAt: Date | null;
    } | null>;
    getNotice(id: string): Promise<Notice | null>;
    findByIdemKey(idemKey: string): Promise<Notice | null>;
    listNotices(filter: NoticeListFilter, now: Date): Promise<{
        items: Notice[];
        nextCursor: string | null;
    }>;
    deleteNotice(id: string): Promise<boolean>;
    updateBatchStatus(batchId: string, patch: Pick<Notice, "status" | "revokedAt" | "updatedAt">, onlySource?: string): Promise<number>;
    pruneDeliveries(noticeId: string, keep: string[]): Promise<number>;
    insertDeliveries(rows: {
        noticeId: string;
        userId: string;
        payload: Record<string, unknown> | null;
        createdAt: Date;
    }[]): Promise<void>;
    listFeed(ctx: PlayerContext, q: FeedQuery, now: Date): Promise<{
        items: FeedItem[];
        nextCursor: string | null;
    }>;
    countUnread(ctx: PlayerContext, now: Date): Promise<number>;
    getReceipt(noticeId: string, userId: string): Promise<NoticeReceipt | null>;
    countByPhase(now: Date): Promise<Record<NoticePhase, number>>;
    touchReceipts(userId: string, noticeIds: string[], patch: ReceiptPatch): Promise<void>;
    markAllRead(ctx: PlayerContext, now: Date): Promise<number>;
    bumpPopup(noticeId: string, userId: string, now: Date): Promise<void>;
    stats(noticeId: string): Promise<NoticeStats>;
    purge(before: Date): Promise<number>;
    /** 测试辅助:某人当前是否被某条横幅/跑马灯屏蔽 */
    dismissed(noticeId: string, userId: string, now: Date): boolean;
}