/**
 * createFenxiao —— 唯一入口。接入手册见 INTEGRATION.md。
 *
 *   const fx = createFenxiao({ db: pool, getPolicy, notify, publishChange, logger });
 *   注册事务里:   await fx.bind({ userId, code, tx, afterCommit })
 *   付款履约事务里: await fx.settle({ buyerUserId, sourceRef: orderId, baseAmount: paidCents, productKey, tx, afterCommit })
 *   退款事务里:   await fx.reverse({ sourceRef: orderId, reason, tx, afterCommit })
 *   定时:         await fx.releaseDue()
 */
import * as applications from "./applications.ts";
import type { FxRiskCheck } from "./core.ts";
import { type FxChange, type FxNotice, type FxTexts } from "./integrate.ts";
import * as ledger from "./ledger.ts";
import * as members from "./members.ts";
import * as queries from "./queries.ts";
import * as review from "./review.ts";
import { type FxQueryable, type FxTables } from "./sql.ts";
import * as stats from "./stats.ts";
import type { FxEvent, FxPolicy } from "./types.ts";
import * as withdrawals from "./withdrawals.ts";
/** 和 jichu Logger 兼容的最小形状(只用 warn / error) */
export interface FxLogger {
    warn(msg: string, meta?: object): void;
    error(msg: string, meta?: object): void;
}
export interface FenxiaoOptions {
    /** 根查询器:pg Pool(自开事务靠 connect)或带 transaction() 的驱动(PGlite 等) */
    db: FxQueryable;
    tables?: Partial<FxTables>;
    /**
     * 规则(从宿主配置取,每次现取);缺的字段按 DEFAULT_FX_POLICY 补,默认是关。
     * db = 当前该用的查询器:在宿主事务里调时是那个 tx —— 宿主读配置表请用它,别另借连接。
     */
    getPolicy: (db: FxQueryable) => Partial<FxPolicy> | Promise<Partial<FxPolicy>>;
    now?: () => Date;
    /** 风控:返回挂起原因 = 这笔佣金先挂起待人工复核 */
    riskCheck?: FxRiskCheck;
    /** 提交后的原始事件(审计 / 埋点 / 自定义推送);不是入账指令,别在这里改余额 */
    onEvent?: (ev: FxEvent) => void | Promise<void>;
    /** 站内通知(接 tongzhi.send);不给 = 不发 */
    notify?: (n: FxNotice) => void | Promise<void>;
    /** 通知文案覆盖 / 金额格式 / 「查看」链接 */
    notice?: {
        texts?: Partial<FxTexts>;
        formatAmount?: (amount: bigint) => string;
        url?: string | null;
    };
    /** 实时刷新(接 shuaxin publisher.publish);不给 = 不推 */
    publishChange?: (changes: FxChange[]) => void | Promise<void>;
    /** shuaxin 的租户;单租户站点用默认 "default" */
    tenantId?: string;
    logger?: FxLogger;
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
    apply: (input: Parameters<typeof applications.apply>[1]) => Promise<import("./types.ts").FxApplication>;
    reviewApplication: (input: Parameters<typeof applications.reviewApplication>[1]) => Promise<import("./types.ts").FxApplication>;
    settle: (input: ledger.SettleInput) => Promise<import("./types.ts").FxSettleResult>;
    reverse: (input: ledger.ReverseInput) => Promise<{
        count: number;
        amount: bigint;
    }>;
    releaseDue: (o?: Parameters<typeof ledger.releaseDue>[1]) => Promise<number>;
    account: (userId: string) => Promise<import("./types.ts").FxAccount>;
    reviewCommission: (input: Parameters<typeof review.reviewCommission>[1]) => Promise<import("./types.ts").FxCommission>;
    adjust: (input: review.AdjustInput) => Promise<import("./types.ts").FxCommission>;
    requestWithdrawal: (input: Parameters<typeof withdrawals.requestWithdrawal>[1]) => Promise<import("./types.ts").FxWithdrawal>;
    reviewWithdrawal: (input: Parameters<typeof withdrawals.reviewWithdrawal>[1]) => Promise<import("./types.ts").FxWithdrawal>;
    listMembers: (q?: queries.ListMembersQuery) => Promise<queries.Paged<queries.MemberRow>>;
    listDownline: (q: Parameters<typeof queries.listDownline>[1]) => Promise<queries.Paged<queries.DownlineRow>>;
    listCommissions: (q?: queries.ListCommissionsQuery) => Promise<queries.Paged<import("./types.ts").FxCommission> & {
        amountSum: bigint;
    }>;
    listWithdrawals: (q?: Parameters<typeof queries.listWithdrawals>[1]) => Promise<queries.Paged<import("./types.ts").FxWithdrawal>>;
    listApplications: (q?: Parameters<typeof queries.listApplications>[1]) => Promise<queries.Paged<import("./types.ts").FxApplication>>;
    listAudit: (q?: Parameters<typeof queries.listAudit>[1]) => Promise<queries.Paged<import("./types.ts").FxAuditEntry>>;
    teamStats: (userId: string) => Promise<stats.TeamStats>;
    overview: (since: Date) => Promise<stats.FxOverview>;
    leaderboard: (q: Parameters<typeof stats.leaderboard>[1]) => Promise<stats.LeaderRow[]>;
};
export type Fenxiao = ReturnType<typeof createFenxiao>;