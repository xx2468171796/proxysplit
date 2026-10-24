/**
 * 统计:个人团队统计、全站总览、排行榜。每个函数一条 SQL。
 */
import type { Deps } from "./core.ts";
export interface TeamStats {
    direct: number;
    team: number;
    /** 团队带来的付款笔数(按来源去重)与佣金合计(不含冲回) */
    paidOrders: number;
    commissionTotal: bigint;
}
export declare function teamStats(d: Deps, userId: string): Promise<TeamStats>;
export interface FxOverview {
    boundMembers: number;
    agents: number;
    frozen: bigint;
    held: bigint;
    available: bigint;
    withdrawing: bigint;
    withdrawn: bigint;
    reversed: bigint;
    pendingWithdrawals: number;
    pendingApplications: number;
    heldCommissions: number;
    /** since 起产生的佣金(不含冲回)与笔数 */
    periodCommission: bigint;
    periodCount: number;
}
export declare function overview(d: Deps, since: Date): Promise<FxOverview>;
export interface LeaderRow {
    userId: string;
    /** since 起的有效佣金(不含冲回、不含调账) */
    amount: bigint;
    orders: number;
}
/** 排行榜:since 起佣金最多的前 limit 名(≤100) */
export declare function leaderboard(d: Deps, query: {
    since: Date;
    limit?: number;
}): Promise<LeaderRow[]>;