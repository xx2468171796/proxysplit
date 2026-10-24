import { type Deps } from "./core.ts";
import { type FxQueryable } from "./sql.ts";
import { type FxBindResult, type FxMember, type FxTxInput } from "./types.ts";
export declare const normalizeCode: (code: string) => string;
export declare const isValidCode: (code: string) => boolean;
export declare function memberOf(q: FxQueryable, d: Deps, userId: string, lock?: boolean): Promise<FxMember | null>;
export declare function findByCode(d: Deps, code: string, q?: FxQueryable, lock?: boolean): Promise<FxMember | null>;
export declare function ensureRow(q: FxQueryable, d: Deps, userId: string): Promise<void>;
/**
 * 注册那一刻:带码绑上级(在宿主建号事务里调并传 tx)。不抛错:坏码只是不绑定。
 * 已经有上级的人返回 ALREADY_BOUND(一生一次;要改走后台 moveMember)。
 */
export declare function bind(d: Deps, input: {
    userId: string;
    code: string;
} & FxTxInput<FxQueryable>): Promise<FxBindResult>;
export declare function assignCode(q: FxQueryable, d: Deps, userId: string, wanted?: string): Promise<string>;
/** 推广人领自己的邀请码:人人可推广时谁都能领;否则只有设了等级的人能领(NOT_ELIGIBLE) */
export declare function ensureCode(d: Deps, userId: string, tx?: FxQueryable): Promise<FxMember>;
export interface SetMemberInput extends FxTxInput<FxQueryable> {
    userId: string;
    /** 谁操作的(写审计) */
    operatorId: string;
    /** undefined = 不改;null = 取消等级(变回普通用户) */
    tierCode?: string | null;
    enabled?: boolean;
    rateOverride?: number[] | null;
    note?: string | null;
    /** 自定义邀请码(4~16 位大写字母数字) */
    code?: string;
}
/** 后台设分销等级 / 停用 / 逐人比例 / 备注 / 自定义码。设了等级还没码的自动发一个 */
export declare function setMember(d: Deps, input: SetMemberInput): Promise<FxMember>;
/** 后台改挂上级(parentUserId=null 摘成顶层)。挂到自己的下级下面会成环,拒绝(CYCLE) */
export declare function moveMember(d: Deps, input: {
    userId: string;
    parentUserId: string | null;
    operatorId: string;
} & FxTxInput<FxQueryable>): Promise<FxMember>;