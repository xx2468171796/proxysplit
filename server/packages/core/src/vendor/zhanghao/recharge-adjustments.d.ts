/**
 * zhanghao/recharge-adjustments —— 后台手动调整用户的「累充金额」(增 / 删 / 改 / 查)。
 *
 * 业主(2026-09-23):「给账号里面增加一个功能,我可以单独给用户去增加累充金额,在后台用户管理里面,
 * 增删改查都行,统一一下。」—— 补偿、线下收款、迁移漏单这类场景,运营要能直接把累充补上或扣掉。
 *
 * ── 口径(接入前必读) ─────────────────────────────────────────────────────
 *
 *   有效累充 = max(0, 真实充值 + Σ 生效中的调整)          ← `effectiveCents(userId, realCents)`
 *
 *   1. 调整是**一条条带原因的记录**,可正可负。「改」改金额/原因,「删」= 作废(留痕,不抹掉)。
 *      每一次增 / 改 / 删都落一条事件(改前 → 改后、谁、何时、requestId),事后能完整复原。
 *   2. **只进「按累充裁决」的那一处**(各站的「有效累充」唯一入口:CDK 门槛、累充活动、开箱门槛……),
 *      **绝不进财务 / 营收 / 对账 / 运营看板** —— 那里只能算真钱。调整混进营收,账就再也对不上,而且不报错。
 *   3. 结果**下限 0**:扣到比真实充值还多时显示 0,不出现负累充(负数进门槛比较不会报错,只会让人永远不达标)。
 *   4. 金额一律**整数分(bigint)**,不碰浮点;界面上给运营看「元」。
 *
 * ── 并发与幂等(三条都靠数据库,不靠「先查再写」)───────────────────────────────
 *
 *   - 新增:`(created_by, request_id)` 唯一。同一个 requestId 重放 → 回原记录(replayed=true),不二次生效;
 *     同一 requestId 拿去加另一笔(用户或金额不同)→ REQUEST_ID_CONFLICT。
 *   - 改 / 删:带 `expectedRevision`,`UPDATE … WHERE revision = $expected AND status = 'active'`。
 *     两个运营同时改同一条,只有一个成功,另一个得到 REVISION_CONFLICT(界面提示刷新),不会互相覆盖。
 *   - 事件与主记录**同一条 SQL**(CTE)写入:不存在「金额改了但没留痕」的中间态,也不需要宿主开事务。
 */
import type { AdminContext } from "./service-contract.ts";
export type RechargeAdjustmentStatus = "active" | "revoked";
export interface RechargeAdjustmentRecord {
    id: string;
    userId: string;
    /** 整数分,可正可负,不为 0 */
    amountCents: bigint;
    reason: string;
    status: RechargeAdjustmentStatus;
    /** 乐观并发版本,每次改 / 删 +1 */
    revision: number;
    requestId: string;
    createdBy: string;
    createdAt: Date;
    updatedBy: string | null;
    updatedAt: Date;
    revokedBy: string | null;
    revokedAt: Date | null;
    revokeReason: string | null;
}
export type RechargeAdjustmentAction = "create" | "update" | "revoke";
/** 事件里存的快照(只存会变的字段) */
export interface RechargeAdjustmentSnapshot {
    amountCents: string;
    reason: string;
    status: RechargeAdjustmentStatus;
}
export interface RechargeAdjustmentEvent {
    id: string;
    adjustmentId: string;
    userId: string;
    action: RechargeAdjustmentAction;
    before: RechargeAdjustmentSnapshot | null;
    after: RechargeAdjustmentSnapshot;
    operatorId: string;
    requestId: string;
    /** 作废原因(revoke 时) */
    note: string | null;
    createdAt: Date;
}
export interface RechargeAdjustmentPatch {
    amountCents?: bigint;
    reason?: string;
}
export interface InsertAdjustmentData {
    userId: string;
    amountCents: bigint;
    reason: string;
    requestId: string;
    createdBy: string;
}
export interface MutateAdjustmentData {
    id: string;
    expectedRevision: number;
    operatorId: string;
    requestId: string;
    /** 改:新值;作废:status=revoked + revokeReason */
    next: {
        amountCents: bigint;
        reason: string;
        status: RechargeAdjustmentStatus;
        revokeReason: string | null;
    };
    action: "update" | "revoke";
}
/**
 * 宿主实现它(或直接用 `createSqlRechargeAdjustmentStore` / `createMemoryRechargeAdjustmentStore`)。
 * 用户 id 一律字符串进出(bigint / cuid / uuid 都行),表里存 text,**不建外键**(各站用户表不同)。
 */
export interface RechargeAdjustmentStore {
    /** 生效中调整之和(分);没有记录 = 0n */
    sumActive(userId: string): Promise<bigint>;
    /** 批量(后台列表一屏多人;可选,没实现就逐个 sumActive) */
    sumActiveMany?(userIds: string[]): Promise<Map<string, bigint>>;
    /** 某人全部调整,新 → 旧 */
    list(userId: string, opts: {
        includeRevoked: boolean;
    }): Promise<RechargeAdjustmentRecord[]>;
    get(id: string): Promise<RechargeAdjustmentRecord | null>;
    findByRequest(createdBy: string, requestId: string): Promise<RechargeAdjustmentRecord | null>;
    /**
     * 原子:插主记录 + 写 create 事件。`(created_by, request_id)` 撞了返回 `{ created:false, row: 已有那条 }`。
     */
    insert(data: InsertAdjustmentData): Promise<{
        created: boolean;
        row: RechargeAdjustmentRecord;
    }>;
    /** 按 (operatorId, requestId) 找改 / 删事件(判重放) */
    findEvent(operatorId: string, requestId: string): Promise<RechargeAdjustmentEvent | null>;
    /**
     * 原子:`revision = expected AND status = 'active'` 才改,同一条语句写事件。
     * 条件不满足(不存在 / 已作废 / 版本不对)返回 null;事件的 (operator_id, request_id) 撞了也返回 null。
     */
    mutate(data: MutateAdjustmentData): Promise<RechargeAdjustmentRecord | null>;
    /** 某人的调整事件流水,新 → 旧,keyset 翻页 */
    listEvents(userId: string, opts: {
        beforeId?: string;
        limit: number;
    }): Promise<RechargeAdjustmentEvent[]>;
}
export interface RechargeAdjustmentOptions {
    store: RechargeAdjustmentStore;
    /**
     * 目标用户存不存在。强烈建议传:不传时给不存在的 id 也能加调整(记录挂空,运营以为加上了)。
     */
    userExists?: (userId: string) => Promise<boolean>;
    /** 单笔金额绝对值上限(分),默认 ¥1,000,000 = 100_000_000 分。填错一个数量级是最常见的事故 */
    maxAbsCents?: bigint;
    /** 每次增 / 改 / 删成功后回调(宿主记审计 / 失效缓存 / 通知);抛错不影响已生效的结果 */
    onChange?: (e: {
        action: RechargeAdjustmentAction;
        row: RechargeAdjustmentRecord;
        operatorId: string;
    }) => void | Promise<void>;
}
export interface AdjustmentResult {
    row: RechargeAdjustmentRecord;
    /** true = 这个 requestId 此前已执行,本次没有重复生效 */
    replayed: boolean;
}
export interface RechargeAdjustments {
    /** 生效中调整之和(分) */
    sumActive(userId: string): Promise<bigint>;
    sumActiveMany(userIds: string[]): Promise<Map<string, bigint>>;
    /**
     * 有效累充 = max(0, realCents + 调整之和)。各站「有效累充」唯一入口里调它,**不要自己再加一遍**。
     */
    effectiveCents(userId: string, realCents: bigint): Promise<bigint>;
    list(userId: string, opts?: {
        includeRevoked?: boolean;
    }): Promise<RechargeAdjustmentRecord[]>;
    events(userId: string, opts?: {
        beforeId?: string;
        limit?: number;
    }): Promise<RechargeAdjustmentEvent[]>;
    create(input: {
        userId: string;
        amountCents: bigint;
        reason: string;
    }, ctx: AdminContext): Promise<AdjustmentResult>;
    update(id: string, input: RechargeAdjustmentPatch & {
        expectedRevision: number;
    }, ctx: AdminContext): Promise<AdjustmentResult>;
    revoke(id: string, input: {
        reason: string;
        expectedRevision: number;
    }, ctx: AdminContext): Promise<AdjustmentResult>;
}
export declare const DEFAULT_MAX_ABS_ADJUSTMENT_CENTS = 100000000n;
export declare const MAX_ADJUSTMENT_REASON_LENGTH = 200;
export declare function snapshotOf(row: Pick<RechargeAdjustmentRecord, "amountCents" | "reason" | "status">): RechargeAdjustmentSnapshot;
export declare function createRechargeAdjustments(opts: RechargeAdjustmentOptions): RechargeAdjustments;
/**
 * 运营输入的「元」→ 分。只认 `-?\d+(\.\d{1,2})?`,**不经过浮点**(`0.1+0.2` 那类误差进钱账不报错)。
 * 非法返回 null(调用方自己提示),不夹取、不四舍五入。
 */
export declare function yuanToCents(input: string): bigint | null;
/**
 * 分 → 「¥1,234.50」:符号在 ¥ 前面(「-¥20.00」「+¥80.50」),不会出现「¥+80.50」。
 * 界面显示一律用它,别自己拼「¥」+ centsToYuan。
 */
export declare function formatYuan(cents: bigint, opts?: {
    signed?: boolean;
}): string;
/** 分 → 「1,234.50」(带正负号可选;不带 ¥。要 ¥ 用 formatYuan) */
export declare function centsToYuan(cents: bigint, opts?: {
    signed?: boolean;
}): string;
export declare function createMemoryRechargeAdjustmentStore(now?: () => Date): RechargeAdjustmentStore;
export interface SqlRechargeAdjustmentStoreOptions {
    /** node-postgres Pool / Client、postgres.js 包一层、Prisma `$queryRawUnsafe` 包一层都行 */
    query(text: string, params?: unknown[]): Promise<{
        rows: any[];
    }>;
    /** 表名(默认 zh_recharge_adjustments / zh_recharge_adjustment_events);列名不可改,见 sql/recharge-adjustments.sql */
    tableNames?: Partial<{
        adjustments: string;
        events: string;
    }>;
}
export declare function createSqlRechargeAdjustmentStore(o: SqlRechargeAdjustmentStoreOptions): RechargeAdjustmentStore;