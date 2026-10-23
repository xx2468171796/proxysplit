import type { LedgerDeps } from "./ledger.ts";
import type { FxAccount, FxCommission, FxCommissionStatus, FxMember, FxWithdrawal, FxWithdrawalStatus } from "./types.ts";
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
export declare function listMembers(d: LedgerDeps, query?: ListMembersQuery): Promise<Paged<MemberRow>>;
export interface DownlineRow extends FxMember {
    /** 相对查询人的层级:1 = 直接下级 */
    depth: number;
}
/** 某人的团队(下级):level 不传 = 全部层级 */
export declare function listDownline(d: LedgerDeps, query: {
    userId: string;
    level?: number;
    limit?: number;
    offset?: number;
}): Promise<Paged<DownlineRow>>;
export interface ListCommissionsQuery {
    beneficiaryUserId?: string;
    buyerUserId?: string;
    status?: FxCommissionStatus;
    sourceRef?: string;
    limit?: number;
    offset?: number;
}
export declare function listCommissions(d: LedgerDeps, query?: ListCommissionsQuery): Promise<Paged<FxCommission> & {
    amountSum: bigint;
}>;
export declare function listWithdrawals(d: LedgerDeps, query?: {
    userId?: string;
    status?: FxWithdrawalStatus;
    limit?: number;
    offset?: number;
}): Promise<Paged<FxWithdrawal>>;
export interface TeamStats {
    direct: number;
    team: number;
    /** 团队带来的付款笔数(按来源去重)与佣金合计(不含冲回) */
    paidOrders: number;
    commissionTotal: bigint;
}
export declare function teamStats(d: LedgerDeps, userId: string): Promise<TeamStats>;
export interface FxOverview {
    boundMembers: number;
    agents: number;
    frozen: bigint;
    available: bigint;
    withdrawing: bigint;
    withdrawn: bigint;
    reversed: bigint;
    pendingWithdrawals: number;
    /** since 起产生的佣金(不含冲回)与笔数 */
    periodCommission: bigint;
    periodCount: number;
}
export declare function overview(d: LedgerDeps, since: Date): Promise<FxOverview>;