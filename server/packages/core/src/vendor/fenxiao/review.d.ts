/**
 * 后台对佣金的人工动作:复核挂起的佣金(放行 / 作废)、手工调账(补发 / 扣减,必须写原因)。都写审计。
 */
import { type Deps } from "./core.ts";
import { type FxQueryable } from "./sql.ts";
import { type FxCommission, type FxTxInput } from "./types.ts";
/** 复核挂起的佣金:approve = 放行(冻结期没过进冻结,过了直接可提现);void = 作废(记为冲回) */
export declare function reviewCommission(d: Deps, input: {
    id: bigint | string;
    action: "approve" | "void";
    operatorId: string;
    note?: string;
} & FxTxInput<FxQueryable>): Promise<FxCommission>;
export interface AdjustInput extends FxTxInput<FxQueryable> {
    userId: string;
    /** 正数补发,负数扣减;直接进可提现(扣成负数 = 欠款) */
    amount: bigint;
    /** 原因(必填,推广人能看到) */
    reason: string;
    operatorId: string;
    /** 调账单号:同一个 ref 只生效一次(防重复点);不传自动生成 */
    ref?: string;
}
/** 手工调账:落一条 sourceKind=adjust 的流水,余额即时变 */
export declare function adjust(d: Deps, input: AdjustInput): Promise<FxCommission>;