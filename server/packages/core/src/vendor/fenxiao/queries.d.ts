/**
 * 只读查询:成员 / 下级 / 佣金 / 提现 / 申请 / 审计列表(全部分页,limit ≤100)、团队统计、总览、排行榜。
 * 每个函数固定一条 SQL(不随页大小变,xingneng 的 N+1 门禁在 test/sql-budget.test.ts 盯着)。
 * WHERE 只由固定片段拼接,值全部走参数。
 */
import type { Deps } from "./core.ts";
import type { FxAccount, FxApplication, FxApplicationStatus, FxAuditEntry, FxCommission, FxCommissionStatus, FxMember, FxWithdrawal, FxWithdrawalStatus } from "./types.ts";
export interface Paged<T> {
    items: T[];
    total: number;
    limit: number;
    offset: number;
}
export interface MemberRow extends FxMember {
    directCount: number;
    teamCount: number;
    account: FxAccount;
}
export interface ListMembersQuery {
    /** 只看有分销等级的人 */
    agentsOnly?: boolean;
    tierCode?: string;
    parentUserId?: string;
    /** 宿主按用户名搜到的一批 id */
    userIds?: string[];
    limit?: number;
    offset?: number;
}
export declare function listMembers(d: Deps, query?: ListMembersQuery): Promise<Paged<MemberRow>>;
export interface DownlineRow extends FxMember {
    /** 相对查询人的层级:1 = 直接下级 */
    depth: number;
}
/** 某人的团队(下级):level 不传 = 全部层级 */
export declare function listDownline(d: Deps, query: {
    userId: string;
    level?: number;
    limit?: number;
    offset?: number;
}): Promise<Paged<DownlineRow>>;
export interface ListCommissionsQuery {
    beneficiaryUserId?: string;
    buyerUserId?: string;
    status?: FxCommissionStatus;
    sourceKind?: string;
    sourceRef?: string;
    productKey?: string;
    since?: Date;
    limit?: number;
    offset?: number;
}
export declare function listCommissions(d: Deps, query?: ListCommissionsQuery): Promise<Paged<FxCommission> & {
    amountSum: bigint;
}>;
export declare function listWithdrawals(d: Deps, query?: {
    userId?: string;
    status?: FxWithdrawalStatus;
    limit?: number;
    offset?: number;
}): Promise<Paged<FxWithdrawal>>;
export declare function listApplications(d: Deps, query?: {
    userId?: string;
    status?: FxApplicationStatus;
    limit?: number;
    offset?: number;
}): Promise<Paged<FxApplication>>;
export declare function listAudit(d: Deps, query?: {
    targetUserId?: string;
    action?: string;
    limit?: number;
    offset?: number;
}): Promise<Paged<FxAuditEntry>>;