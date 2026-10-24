import { type Deps } from "./core.ts";
import { type FxQueryable } from "./sql.ts";
import type { FxAccount, FxSettleResult, FxTxInput } from "./types.ts";
export interface SettleInput extends FxTxInput<FxQueryable> {
    buyerUserId: string;
    /** 来源种类,默认 "order" */
    sourceKind?: string;
    /** 回调重放也不变的值(订单 id / 拆单组 id) */
    sourceRef: string;
    /** 返佣基数(宿主单位,通常是实付分) */
    baseAmount: bigint;
    /** 商品 / 套餐代码(对应规则 products[].key);不传 = 没有商品规则 */
    productKey?: string;
}
/** 付款结算:在宿主履约事务里调(传 tx)。不抛业务错:不返的情况返回 reason */
export declare function settle(d: Deps, input: SettleInput): Promise<FxSettleResult>;
export interface ReverseInput extends FxTxInput<FxQueryable> {
    sourceKind?: string;
    sourceRef: string;
    reason: string;
}
/** 退款冲回:这一来源下没冲过的佣金全部作废;已转可提现的从可提现扣(可能扣成负数 = 欠款,后续佣金先抵) */
export declare function reverse(d: Deps, input: ReverseInput): Promise<{
    count: number;
    amount: bigint;
}>;
/** 冻结期到了的佣金转可提现。宿主定时调(每几分钟一次,幂等,可多实例并发);查余额时也会先给这个人跑一次 */
export declare function releaseDue(d: Deps, opts?: {
    userId?: string;
    limit?: number;
} & FxTxInput<FxQueryable>): Promise<number>;
export declare function account(d: Deps, userId: string): Promise<FxAccount>;