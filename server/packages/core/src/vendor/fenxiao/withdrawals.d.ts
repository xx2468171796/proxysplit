/**
 * 提现:推广人申请(从可提现转到提现中,按规则算手续费)→ 后台审核:paid = 财务已线下打款(只记账),
 * rejected = 退回可提现。包不打款。
 */
import { type Deps } from "./core.ts";
import { type FxQueryable } from "./sql.ts";
import { type FxPayee, type FxTxInput, type FxWithdrawal } from "./types.ts";
export declare function requestWithdrawal(d: Deps, input: {
    userId: string;
    amount: bigint;
    payee: FxPayee;
} & FxTxInput<FxQueryable>): Promise<FxWithdrawal>;
/** 后台审核:paid = 财务已线下打款(只记账;账户的已提现记申请金额 amount,手续费见提现单 fee,实付 = net);rejected = 退回可提现(驳回必须写原因) */
export declare function reviewWithdrawal(d: Deps, input: {
    id: bigint | string;
    action: "paid" | "rejected";
    operatorId: string;
    note?: string;
} & FxTxInput<FxQueryable>): Promise<FxWithdrawal>;