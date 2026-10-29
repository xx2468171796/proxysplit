/**
 * 纯逻辑内核(零 I/O):输入归一化与校验、生效窗口、阶段派生、受众裁决、弹窗频控。
 * service / store / 前端 都从这里取同一份判定,别在别处再写一份。
 */
import { type Audience, type Notice, type NoticeInput, type NoticePatch, type NoticePhase, type NoticeReceipt, type PlayerContext, type Surface } from "../types.ts";
export declare const DEFAULTS: {
    readonly kind: "system";
    readonly severity: "normal";
    readonly surfaces: Surface[];
    readonly frequency: "once";
    readonly frequencyHours: 24;
    readonly maxPopups: 1;
    readonly sortOrder: 0;
};
export declare const LIMITS: {
    readonly title: 120;
    readonly body: 20000;
    readonly actions: 2;
    readonly actionLabel: 24;
    readonly audienceValues: 5000;
    readonly idemKey: 128;
    readonly batchId: 64;
};
export declare function toDateOrNull(v: Date | string | null | undefined, field: string): Date | null;
export declare function normalizeAudience(v: unknown): Audience;
/** 受众里的值列表(存储用 text[]);all = [] */
export declare function audienceValues(a: Audience): string[];
export declare function audienceFromParts(type: string, values: string[]): Audience;
export declare function normalizeActions(v: unknown): Notice["actions"];
/** 只放行站内相对路径与 http(s);javascript:/data: 一类一律拒 */
export declare function isSafeUrl(url: string): boolean;
/** 输入 → 可入库的字段集(不含 id / 时间戳 / 状态);全部校验在此 */
export declare function normalizeInput(raw: NoticeInput): Omit<Notice, "id" | "status" | "source" | "createdBy" | "createdAt" | "updatedAt" | "publishedAt" | "revokedAt">;
/** 局部更新:把 patch 叠在已有 notice 上再整体校验(改一个字段也走全量校验,省得两套规则) */
export declare function applyPatch(notice: Notice, patch: NoticePatch): ReturnType<typeof normalizeInput>;
/** 此刻是否在生效窗口内(不看 status) */
export declare function isWithinWindow(n: Pick<Notice, "startAt" | "endAt">, now: Date): boolean;
export declare function isLive(n: Pick<Notice, "status" | "startAt" | "endAt">, now: Date): boolean;
export declare function phaseOf(n: Pick<Notice, "status" | "startAt" | "endAt">, now: Date): NoticePhase;
/** 受众裁决(users 型在 store 里靠 delivery 索引裁,这里只处理属性型;users 型给 true 交给索引) */
export declare function matchesAudience(a: Audience, ctx: PlayerContext): boolean;
/** 按本地(宿主传的 tzOffsetMin)切「今天」;默认 UTC+8(生态各站都是国内玩家) */
export declare function dayKey(d: Date, tzOffsetMin?: number): number;
/**
 * 弹窗频控 —— 唯一真相:
 *   once  : 弹过就不弹(maxPopups 生效)
 *   every : 每次进站都弹(maxPopups=0 不限,否则封顶)
 *   daily : 上次弹的不是今天就弹;maxPopups 封顶
 *   gap   : 距上次 ≥ frequencyHours 小时就弹;maxPopups 封顶
 * 已 archived / 点了「我已阅读」(readAt 且 forceRead) / dismissedUntil 未到 ⇒ 不弹。
 */
export declare function shouldPopup(n: Notice, r: NoticeReceipt | null, now: Date, tzOffsetMin?: number): boolean;
/** 横幅/跑马灯是否被本人临时关掉 */
export declare function isDismissed(r: NoticeReceipt | null, now: Date): boolean;
export declare function isUnread(r: NoticeReceipt | null): boolean;
export declare function compareNotices(a: Notice, b: Notice): number;
/** PG text[] 字面量(给 `$n::text[]` 用;跨 pg / postgres.js / Prisma 都稳,不依赖驱动的数组序列化) */
export declare function pgArrayLiteral(values: readonly string[]): string;
/** offset 型游标(通知列表很小,不做 keyset) */
export declare function decodeCursor(c: string | null | undefined): number;
export declare function encodeCursor(offset: number, pageLen: number, limit: number): string | null;
export declare function clampLimit(v: number | undefined, def?: number, max?: number): number;
/** 群发批次号 */
export declare function newBatchId(now?: Date): string;
/** 通知 → JSON 安全的 wire 形状(Date → ISO) */
export declare function noticeToWire(n: Notice, now?: Date): {
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
    surfaces: Surface[];
    title: string;
    body: string;
    cover: string | null;
    icon: string | null;
    actions: import("../types.ts").NoticeAction[];
    audience: Audience;
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
};
export type NoticeWire = ReturnType<typeof noticeToWire>;
/** 玩家侧 wire:去掉管理字段(受众名单 / 操作者 / 幂等键 / 批次 / meta / 来源)—— 定向通知的收件人名单绝不能发给每个收件人 */
export declare function noticeToPlayerWire(n: Notice, now?: Date): {
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
    surfaces: Surface[];
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
export type NoticePlayerWire = ReturnType<typeof noticeToPlayerWire>;
export declare function receiptToWire(r: NoticeReceipt | null): {
    seenAt: string | null;
    readAt: string | null;
    archivedAt: string | null;
    dismissedUntil: string | null;
    popupCount: number;
    lastPopupAt: string | null;
} | null;
export type ReceiptWire = NonNullable<ReturnType<typeof receiptToWire>>;
/** wire → Notice(浏览器端 / CLI 反序列化用) */
export declare function noticeFromWire(w: NoticeWire): Notice;