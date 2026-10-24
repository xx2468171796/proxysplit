/**
 * 申请成为推广员:规则 application = review 时进待审,auto 时当场通过;off 时不开放(后台直接设等级)。
 * 通过 = 给 applicationTierCode 等级(没配就只开人人可推广的默认比例)并发邀请码。
 */
import { type Deps } from "./core.ts";
import { type FxQueryable } from "./sql.ts";
import { type FxApplication, type FxTxInput } from "./types.ts";
/** 用户申请。已有资格 → APPLICATION_CLOSED;已有待审的 → 原样返回(幂等) */
export declare function apply(d: Deps, input: {
    userId: string;
    message?: string;
} & FxTxInput<FxQueryable>): Promise<FxApplication>;
/** 后台审核申请 */
export declare function reviewApplication(d: Deps, input: {
    id: bigint | string;
    action: "approve" | "reject";
    operatorId: string;
    note?: string;
} & FxTxInput<FxQueryable>): Promise<FxApplication>;