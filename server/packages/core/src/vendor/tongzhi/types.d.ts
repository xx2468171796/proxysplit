/**
 * tongzhi(通知)—— 统一通知模块的类型契约。
 *
 * 一份模型装下「公告」和「站内信」:
 *   - Notice        一条通知的定义(全员公告、定向消息都在这;定向靠 audience + delivery 索引)
 *   - NoticeDelivery 定向通知的 (noticeId, userId) 索引行,可带每人不同的 payload
 *   - NoticeReceipt  某人对某条的回执:seen(铃铛看过)≠ read(点开)≠ archived,外加弹窗计数与「今日不再提示」
 *
 * 展示面(surfaces)由同一条通知勾选:inbox 铃铛收件箱 / modal 登录弹窗 / marquee 跑马灯 / banner 横幅 / toast 即时提示。
 * 包内**永不存**昵称/手机号/登录名,用户只有不透明 id;受众里的会员档位/标签/角色由宿主在读取时投影进来(PlayerContext)。
 */
export declare const NOTICE_KINDS: readonly ["system", "maintenance", "event", "reward", "warning"];
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export declare const SEVERITIES: readonly ["low", "normal", "high", "critical"];
export type Severity = (typeof SEVERITIES)[number];
export declare const SURFACES: readonly ["inbox", "modal", "marquee", "banner", "toast"];
export type Surface = (typeof SURFACES)[number];
export declare const FREQUENCY_MODES: readonly ["once", "daily", "every", "gap"];
/** once 只弹一次 / daily 每天首次 / every 每次进站 / gap 每隔 N 小时 */
export type FrequencyMode = (typeof FREQUENCY_MODES)[number];
export declare const NOTICE_STATUSES: readonly ["draft", "published", "revoked"];
/** 存储态;live / scheduled / expired 由时间派生,见 NoticePhase */
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];
export declare const NOTICE_PHASES: readonly ["draft", "scheduled", "live", "expired", "revoked"];
export type NoticePhase = (typeof NOTICE_PHASES)[number];
export declare const AUDIENCE_TYPES: readonly ["all", "users", "tiers", "tags", "roles"];
export type AudienceType = (typeof AUDIENCE_TYPES)[number];
export type Audience = {
    type: "all";
} | {
    type: "users";
    userIds: string[];
} | {
    type: "tiers";
    tiers: string[];
} | {
    type: "tags";
    tags: string[];
} | {
    type: "roles";
    roles: string[];
};
export interface NoticeAction {
    label: string;
    url: string;
    style?: "primary" | "secondary";
}
export interface Notice {
    id: string;
    kind: NoticeKind;
    severity: Severity;
    surfaces: Surface[];
    title: string;
    /** Markdown 子集(见 core/markdown.ts),渲染永远走白名单转 React 节点,不是 innerHTML */
    body: string;
    cover: string | null;
    /** 图标键覆盖(空 = 按 kind 取默认);宿主的 icons 表按这个键查 */
    icon: string | null;
    actions: NoticeAction[];
    audience: Audience;
    startAt: Date | null;
    endAt: Date | null;
    pinned: boolean;
    sortOrder: number;
    frequency: FrequencyMode;
    /** frequency=gap 时的小时数 */
    frequencyHours: number;
    /** 弹窗最多弹几次;0 = 不限 */
    maxPopups: number;
    /** 弹窗必须点「我已阅读」才能关 */
    forceRead: boolean;
    closable: boolean;
    status: NoticeStatus;
    /** 调用方给的幂等键(全表唯一);重复 create 返回已有那条 */
    idemKey: string | null;
    /** 一次群发/一次跨站推送的批次号,整批撤回用 */
    batchId: string | null;
    /** 来源:admin / api / push:<site> / cli */
    source: string;
    /** 操作者:真人管理员 id 或 `ai:<actor>` */
    createdBy: string;
    meta: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    publishedAt: Date | null;
    revokedAt: Date | null;
}
export interface NoticeDelivery {
    noticeId: string;
    userId: string;
    payload: Record<string, unknown> | null;
    createdAt: Date;
}
export interface NoticeReceipt {
    noticeId: string;
    userId: string;
    seenAt: Date | null;
    readAt: Date | null;
    archivedAt: Date | null;
    dismissedUntil: Date | null;
    popupCount: number;
    lastPopupAt: Date | null;
}
/** 宿主在读取时投影进来的玩家侧上下文(受众裁决用);包不存这些 */
export interface PlayerContext {
    userId: string;
    tier?: string | null;
    tags?: string[];
    roles?: string[];
}
/** 新建 / 更新用的输入(全部可选,缺省见 core/logic.ts 的 DEFAULTS) */
export interface NoticeInput {
    kind?: NoticeKind;
    severity?: Severity;
    surfaces?: Surface[];
    title: string;
    body?: string;
    cover?: string | null;
    icon?: string | null;
    actions?: NoticeAction[];
    audience?: Audience;
    startAt?: Date | string | null;
    endAt?: Date | string | null;
    pinned?: boolean;
    sortOrder?: number;
    frequency?: FrequencyMode;
    frequencyHours?: number;
    maxPopups?: number;
    forceRead?: boolean;
    closable?: boolean;
    idemKey?: string | null;
    batchId?: string | null;
    meta?: Record<string, unknown>;
}
export type NoticePatch = Partial<NoticeInput>;
/** 业务代码给某人 / 某些人发一条定向消息(到账、中奖、退款…) */
export interface SendInput extends Omit<NoticeInput, "audience"> {
    userId?: string;
    userIds?: string[];
    /** 每人不同的载荷(金额、物品名…),按 userId 取 */
    payloads?: Record<string, Record<string, unknown>>;
}
/** 玩家侧看到的一条(通知 + 本人回执 + 本人 payload) */
export interface FeedItem {
    notice: Notice;
    receipt: NoticeReceipt | null;
    payload: Record<string, unknown> | null;
}
export interface FeedQuery {
    surface?: Surface;
    /** 命中任一展示面(bundle 一次取齐用);与 surface 二选一 */
    surfaces?: Surface[];
    unreadOnly?: boolean;
    includeArchived?: boolean;
    kind?: NoticeKind;
    limit?: number;
    cursor?: string | null;
}
export interface FeedPage {
    items: FeedItem[];
    nextCursor: string | null;
}
export interface NoticeListFilter {
    status?: NoticeStatus;
    phase?: NoticePhase;
    kind?: NoticeKind;
    surface?: Surface;
    batchId?: string;
    q?: string;
    limit?: number;
    cursor?: string | null;
}
export interface NoticeListPage {
    items: Notice[];
    nextCursor: string | null;
}
export interface NoticeStats {
    noticeId: string;
    seen: number;
    read: number;
    archived: number;
    popups: number;
    /** 定向通知的投递人数;全员 = null(宿主可用 countUsers 估算) */
    delivered: number | null;
}
export type TongzhiErrorCode = "NOT_FOUND" | "INVALID_INPUT" | "INVALID_STATE" | "UNAUTHORIZED" | "SIGNATURE_INVALID" | "REPLAY";
export declare class TongzhiError extends Error {
    readonly code: TongzhiErrorCode;
    constructor(code: TongzhiErrorCode, message: string);
}