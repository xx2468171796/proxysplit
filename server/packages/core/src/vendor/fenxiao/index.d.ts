import * as ledger from "./ledger.ts";
import * as members from "./members.ts";
import * as queries from "./queries.ts";
import { type FxQueryable, type FxTables } from "./sql.ts";
import type { FxEvent, FxPolicy } from "./types.ts";
export * from "./types.ts";
export { assertFxPolicy, computeShares, ratesFor, findTier, chainUnder, DEFAULT_FX_POLICY, BPS, MAX_CHAIN, MAX_LEVELS } from "./compute.ts";
export { DEFAULT_TABLES, type FxQueryable, type FxTables } from "./sql.ts";
export { normalizeCode, type SetMemberInput } from "./members.ts";
export type { SettleInput, ReverseInput } from "./ledger.ts";
export type { Paged, MemberRow, DownlineRow, ListMembersQuery, ListCommissionsQuery, TeamStats, FxOverview } from "./queries.ts";
export interface FenxiaoOptions {
    /** 根查询器:pg Pool(自开事务靠 connect)或带 transaction() 的驱动 */
    db: FxQueryable;
    tables?: Partial<FxTables>;
    /**
     * 规则(从宿主配置取,每次现取);默认值必须是关(DEFAULT_FX_POLICY.enabled=false)。
     * db = 当前该用的查询器:在宿主事务里调时是那个 tx —— 宿主读配置表请用它,别另借连接。
     */
    getPolicy: (db: FxQueryable) => FxPolicy | Promise<FxPolicy>;
    now?: () => Date;
    /** 提交后的通知(审计 / 推送);不是入账指令,别在这里改余额 */
    onEvent?: (ev: FxEvent) => void | Promise<void>;
    onWarn?: (message: string, err: unknown) => void;
}
export declare function createFenxiao(opts: FenxiaoOptions): {
    tables: FxTables;
    getPolicy: () => Promise<FxPolicy>;
    bind: (input: Parameters<typeof members.bind>[1]) => Promise<import("./types.ts").FxBindResult>;
    ensureCode: (userId: string, tx?: FxQueryable) => Promise<import("./types.ts").FxMember>;
    getMember: (userId: string) => Promise<import("./types.ts").FxMember | null>;
    findByCode: (code: string) => Promise<import("./types.ts").FxMember | null>;
    setMember: (input: members.SetMemberInput) => Promise<import("./types.ts").FxMember>;
    moveMember: (input: Parameters<typeof members.moveMember>[1]) => Promise<import("./types.ts").FxMember>;
    settle: (input: ledger.SettleInput) => Promise<import("./types.ts").FxSettleResult>;
    reverse: (input: ledger.ReverseInput) => Promise<{
        count: number;
        amount: bigint;
    }>;
    releaseDue: (o?: Parameters<typeof ledger.releaseDue>[1]) => Promise<number>;
    account: (userId: string) => Promise<import("./types.ts").FxAccount>;
    requestWithdrawal: (input: Parameters<typeof ledger.requestWithdrawal>[1]) => Promise<import("./types.ts").FxWithdrawal>;
    reviewWithdrawal: (input: Parameters<typeof ledger.reviewWithdrawal>[1]) => Promise<import("./types.ts").FxWithdrawal>;
    listMembers: (q?: queries.ListMembersQuery) => Promise<queries.Paged<queries.MemberRow>>;
    listDownline: (q: Parameters<typeof queries.listDownline>[1]) => Promise<queries.Paged<queries.DownlineRow>>;
    listCommissions: (q?: queries.ListCommissionsQuery) => Promise<queries.Paged<import("./types.ts").FxCommission> & {
        amountSum: bigint;
    }>;
    listWithdrawals: (q?: Parameters<typeof queries.listWithdrawals>[1]) => Promise<queries.Paged<import("./types.ts").FxWithdrawal>>;
    teamStats: (userId: string) => Promise<queries.TeamStats>;
    overview: (since: Date) => Promise<queries.FxOverview>;
};
export type Fenxiao = ReturnType<typeof createFenxiao>;