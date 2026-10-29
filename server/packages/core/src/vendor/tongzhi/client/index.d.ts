/**
 * 浏览器端:REST 客户端 + 一个带轮询/SSE 的状态机(React 组件和任何前端都能用)。
 * 零依赖;不知道宿主怎么鉴权 —— 默认 `credentials: "include"` 带 cookie,别的方式用 fetch 参数覆盖。
 */
import type { BundleWire, FeedItemWire } from "../http/handlers.ts";
import type { FeedQuery } from "../types.ts";
export interface TongzhiClientOptions {
    /** 玩家侧 mount 点,默认 /api/tongzhi */
    base?: string;
    fetch?: typeof fetch;
    headers?: Record<string, string> | (() => Record<string, string>);
}
export declare class TongzhiHttpError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export declare function createTongzhiClient(o?: TongzhiClientOptions): {
    base: string;
    bundle: (inboxLimit?: number) => Promise<{
        unread: number;
        inbox: {
            notice: {
                phase: "draft" | "revoked" | "scheduled" | "live" | "expired";
                startAt: string | null;
                endAt: string | null;
                createdAt: string;
                updatedAt: string;
                publishedAt: string | null;
                revokedAt: string | null;
                id: string;
                kind: import("../types.ts").NoticeKind;
                severity: import("../types.ts").Severity;
                surfaces: import("../types.ts").Surface[];
                title: string;
                body: string;
                cover: string | null;
                icon: string | null;
                actions: import("../types.ts").NoticeAction[];
                pinned: boolean;
                sortOrder: number;
                frequency: import("../types.ts").FrequencyMode;
                frequencyHours: number;
                maxPopups: number;
                forceRead: boolean;
                closable: boolean;
                status: import("../types.ts").NoticeStatus;
            };
            receipt: {
                seenAt: string | null;
                readAt: string | null;
                archivedAt: string | null;
                dismissedUntil: string | null;
                popupCount: number;
                lastPopupAt: string | null;
            } | null;
            payload: Record<string, unknown> | null;
            summary: string;
        }[];
        popups: {
            notice: {
                phase: "draft" | "revoked" | "scheduled" | "live" | "expired";
                startAt: string | null;
                endAt: string | null;
                createdAt: string;
                updatedAt: string;
                publishedAt: string | null;
                revokedAt: string | null;
                id: string;
                kind: import("../types.ts").NoticeKind;
                severity: import("../types.ts").Severity;
                surfaces: import("../types.ts").Surface[];
                title: string;
                body: string;
                cover: string | null;
                icon: string | null;
                actions: import("../types.ts").NoticeAction[];
                pinned: boolean;
                sortOrder: number;
                frequency: import("../types.ts").FrequencyMode;
                frequencyHours: number;
                maxPopups: number;
                forceRead: boolean;
                closable: boolean;
                status: import("../types.ts").NoticeStatus;
            };
            receipt: {
                seenAt: string | null;
                readAt: string | null;
                archivedAt: string | null;
                dismissedUntil: string | null;
                popupCount: number;
                lastPopupAt: string | null;
            } | null;
            payload: Record<string, unknown> | null;
            summary: string;
        }[];
        marquee: {
            notice: {
                phase: "draft" | "revoked" | "scheduled" | "live" | "expired";
                startAt: string | null;
                endAt: string | null;
                createdAt: string;
                updatedAt: string;
                publishedAt: string | null;
                revokedAt: string | null;
                id: string;
                kind: import("../types.ts").NoticeKind;
                severity: import("../types.ts").Severity;
                surfaces: import("../types.ts").Surface[];
                title: string;
                body: string;
                cover: string | null;
                icon: string | null;
                actions: import("../types.ts").NoticeAction[];
                pinned: boolean;
                sortOrder: number;
                frequency: import("../types.ts").FrequencyMode;
                frequencyHours: number;
                maxPopups: number;
                forceRead: boolean;
                closable: boolean;
                status: import("../types.ts").NoticeStatus;
            };
            receipt: {
                seenAt: string | null;
                readAt: string | null;
                archivedAt: string | null;
                dismissedUntil: string | null;
                popupCount: number;
                lastPopupAt: string | null;
            } | null;
            payload: Record<string, unknown> | null;
            summary: string;
        }[];
        banners: {
            notice: {
                phase: "draft" | "revoked" | "scheduled" | "live" | "expired";
                startAt: string | null;
                endAt: string | null;
                createdAt: string;
                updatedAt: string;
                publishedAt: string | null;
                revokedAt: string | null;
                id: string;
                kind: import("../types.ts").NoticeKind;
                severity: import("../types.ts").Severity;
                surfaces: import("../types.ts").Surface[];
                title: string;
                body: string;
                cover: string | null;
                icon: string | null;
                actions: import("../types.ts").NoticeAction[];
                pinned: boolean;
                sortOrder: number;
                frequency: import("../types.ts").FrequencyMode;
                frequencyHours: number;
                maxPopups: number;
                forceRead: boolean;
                closable: boolean;
                status: import("../types.ts").NoticeStatus;
            };
            receipt: {
                seenAt: string | null;
                readAt: string | null;
                archivedAt: string | null;
                dismissedUntil: string | null;
                popupCount: number;
                lastPopupAt: string | null;
            } | null;
            payload: Record<string, unknown> | null;
            summary: string;
        }[];
        toasts: {
            notice: {
                phase: "draft" | "revoked" | "scheduled" | "live" | "expired";
                startAt: string | null;
                endAt: string | null;
                createdAt: string;
                updatedAt: string;
                publishedAt: string | null;
                revokedAt: string | null;
                id: string;
                kind: import("../types.ts").NoticeKind;
                severity: import("../types.ts").Severity;
                surfaces: import("../types.ts").Surface[];
                title: string;
                body: string;
                cover: string | null;
                icon: string | null;
                actions: import("../types.ts").NoticeAction[];
                pinned: boolean;
                sortOrder: number;
                frequency: import("../types.ts").FrequencyMode;
                frequencyHours: number;
                maxPopups: number;
                forceRead: boolean;
                closable: boolean;
                status: import("../types.ts").NoticeStatus;
            };
            receipt: {
                seenAt: string | null;
                readAt: string | null;
                archivedAt: string | null;
                dismissedUntil: string | null;
                popupCount: number;
                lastPopupAt: string | null;
            } | null;
            payload: Record<string, unknown> | null;
            summary: string;
        }[];
        serverTime: string;
    }>;
    feed: (q?: FeedQuery) => Promise<{
        items: FeedItemWire[];
        nextCursor: string | null;
    }>;
    unread: () => Promise<{
        unread: number;
    }>;
    seen: (ids: string[]) => Promise<{
        ok: true;
    }>;
    read: (ids: string[]) => Promise<{
        ok: true;
        unread: number;
    }>;
    readAll: () => Promise<{
        ok: true;
        count: number;
        unread: number;
    }>;
    archive: (ids: string[]) => Promise<{
        ok: true;
        unread: number;
    }>;
    dismiss: (id: string, hours?: number) => Promise<{
        ok: true;
        until: string;
    }>;
    popupShown: (id: string) => Promise<{
        ok: true;
    }>;
};
export type TongzhiClient = ReturnType<typeof createTongzhiClient>;
export interface FeedStateOptions {
    client: TongzhiClient;
    /** 轮询间隔毫秒,默认 60000;0 = 不轮询 */
    pollMs?: number;
    /** 回到页面 / 窗口聚焦时立即刷新(默认 true) */
    refreshOnFocus?: boolean;
    /** SSE 地址(宿主挂了 realtime 才给),收到 invalidate 立即刷新。给了 push 时不再开 SSE(老写法,见 INTEGRATION.md) */
    sseUrl?: string | null;
    /** 聚焦刷新的最小间隔(默认 5000),防抖 */
    minFocusGapMs?: number;
    /**
     * 推送源(1.7 起;通常是 tongzhi/shuaxin 的 tongzhiPushSource):宿主已有 shuaxin 长连接时用它代替 SSE,
     * 一个页面只留一条实时连接。给了它:不开 SSE,轮询降为慢速兜底(pushPollMs)。
     */
    push?: PushSource | null;
    /** 有推送时的兜底轮询间隔,默认 300000(5 分钟);pollMs 为 0 时仍不轮询 */
    pushPollMs?: number;
}
/** 推送源:变了就调 onInvalidate(重新拉 bundle);返回停止函数。不依赖任何实时库 */
export type PushSource = (onInvalidate: () => void) => () => void;
/** 实际轮询间隔:有推送时取 pushPollMs(不小于 pollMs),pollMs 为 0 = 不轮询 */
export declare function feedPollMs(o: Pick<FeedStateOptions, "pollMs" | "push" | "pushPollMs">): number;
export interface FeedState {
    bundle: BundleWire | null;
    loading: boolean;
    error: string | null;
    lastFetchedAt: number | null;
}
/** 与框架无关的状态容器:subscribe 拿快照,start/stop 管生命周期 */
export declare function createFeedState(o: FeedStateOptions): {
    start: () => void;
    stop: () => void;
    refresh: () => Promise<void>;
    subscribe: (l: (s: FeedState) => void) => () => void;
    patchLocal: (fn: (b: BundleWire) => BundleWire) => void;
    getState: () => FeedState;
};
export type FeedStateStore = ReturnType<typeof createFeedState>;
/** 管理侧 REST 客户端(后台 React 组件 / 浏览器里的管理页用;鉴权走宿主 cookie) */
export declare function createTongzhiAdminClient(o?: TongzhiClientOptions): {
    list: (q?: Record<string, string | number | undefined | null>) => Promise<{
        items: NoticeWireLoose[];
        nextCursor: string | null;
    }>;
    get: (id: string) => Promise<NoticeWireLoose>;
    create: (input: Record<string, unknown>, publish?: boolean) => Promise<NoticeWireLoose>;
    update: (id: string, patch: Record<string, unknown>) => Promise<NoticeWireLoose>;
    remove: (id: string) => Promise<{
        ok: boolean;
    }>;
    publish: (id: string) => Promise<NoticeWireLoose>;
    revoke: (id: string) => Promise<NoticeWireLoose>;
    revokeBatch: (batchId: string) => Promise<{
        batchId: string;
        count: number;
    }>;
    stats: (id: string) => Promise<{
        noticeId: string;
        seen: number;
        read: number;
        archived: number;
        popups: number;
        delivered: number | null;
    }>;
    preview: (input: Record<string, unknown>) => Promise<PreviewWire>;
    send: (input: Record<string, unknown>) => Promise<NoticeWireLoose>;
    templates: () => Promise<{
        key: string;
        name: string;
        description: string;
        vars: string[];
        input: Record<string, unknown>;
    }[]>;
    renderTemplate: (key: string, vars: Record<string, string>) => Promise<Record<string, unknown>>;
    status: () => Promise<{
        version: string;
        serverTime: string;
        counts: Record<string, number>;
        templates: string[];
    }>;
};
export type TongzhiAdminClient = ReturnType<typeof createTongzhiAdminClient>;
/** 后台侧用的宽松 wire 形状(Date 已是 ISO 串) */
export interface NoticeWireLoose {
    id: string;
    kind: string;
    severity: string;
    surfaces: string[];
    title: string;
    body: string;
    cover: string | null;
    icon: string | null;
    actions: {
        label: string;
        url: string;
        style?: string;
    }[];
    audience: {
        type: string;
        userIds?: string[];
        tiers?: string[];
        tags?: string[];
        roles?: string[];
    };
    startAt: string | null;
    endAt: string | null;
    pinned: boolean;
    sortOrder: number;
    frequency: string;
    frequencyHours: number;
    maxPopups: number;
    forceRead: boolean;
    closable: boolean;
    status: string;
    phase: string;
    idemKey: string | null;
    batchId: string | null;
    source: string;
    createdBy: string;
    meta: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
    publishedAt: string | null;
    revokedAt: string | null;
}
export interface PreviewWire {
    notice: Record<string, unknown>;
    summary: string;
    phaseIfPublishedNow: string;
    audienceCount: number | null;
    warnings: string[];
}