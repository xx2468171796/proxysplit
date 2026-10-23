import { type FxQueryable, type FxTables } from "./sql.ts";
import { type FxAccount, type FxEvent, type FxPayee, type FxPolicy, type FxSettleResult, type FxWithdrawal } from "./types.ts";
export interface LedgerDeps {
    db: FxQueryable;
    t: FxTables;
    /** 现取规则;传 q = 在这个事务句柄上读(事务里别另借连接,池子满时会互等死锁) */
    policy: (q?: FxQueryable) => Promise<FxPolicy>;
    now: () => Date;
    emit: (ev: FxEvent, afterCommit?: (run: () => Promise<void>) => void) => void;
}
export interface SettleInput {
    buyerUserId: string;
    /** 来源种类,默认 "order" */
    sourceKind?: string;
    /** 回调重放也不变的值(订单 id / 拆单组 id) */
    sourceRef: string;
    /** 返佣基数(宿主单位,通常是实付分) */
    baseAmount: bigint;
    tx?: FxQueryable;
    afterCommit?: (run: () => Promise<void>) => void;
}
export declare function settle(d: LedgerDeps, input: SettleInput): Promise<FxSettleResult>;
export interface ReverseInput {
    sourceKind?: string;
    sourceRef: string;
    reason: string;
    tx?: FxQueryable;
    afterCommit?: (run: () => Promise<void>) => void;
}
/** 退款冲回:这一来源下没冲过的佣金全部作废;已转可提现的从可提现扣(可能扣成负数 = 欠款,后续佣金先抵) */
export declare function reverse(d: LedgerDeps, input: ReverseInput): Promise<{
    count: number;
    amount: bigint;
}>;
/** 冻结期到了的佣金转可提现。宿主定时调(每几分钟一次);查余额时也会先给这个人跑一次 */
export declare function releaseDue(d: LedgerDeps, opts?: {
    userId?: string;
    limit?: number;
    tx?: FxQueryable;
}): Promise<number>;
export declare function account(d: LedgerDeps, userId: string): Promise<FxAccount>;
export declare function requestWithdrawal(d: LedgerDeps, input: {
    userId: string;
    amount: bigint;
    payee: FxPayee;
    tx?: FxQueryable;
    afterCommit?: (run: () => Promise<void>) => void;
}): Promise<FxWithdrawal>;
/** 后台审核:paid = 财务已线下打款(只记账);rejected = 退回可提现 */
export declare function reviewWithdrawal(d: LedgerDeps, input: {
    id: bigint | string;
    action: "paid" | "rejected";
    operatorId: string;
    note?: string;
    tx?: FxQueryable;
}): Promise<FxWithdrawal>;