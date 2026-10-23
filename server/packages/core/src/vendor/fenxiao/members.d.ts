import { type FxQueryable } from "./sql.ts";
import type { LedgerDeps } from "./ledger.ts";
import { type FxBindResult, type FxMember } from "./types.ts";
export declare const normalizeCode: (code: string) => string;
export declare function getMember(d: LedgerDeps, userId: string): Promise<FxMember | null>;
export declare function findByCode(d: LedgerDeps, code: string, q?: FxQueryable, lock?: boolean): Promise<FxMember | null>;
/**
 * 注册那一刻:带码绑上级(在宿主建号事务里调并传 tx)。不抛错:坏码只是不绑定。
 * 已经有上级的人返回 ALREADY_BOUND(一生一次;要改走后台 moveMember)。
 */
export declare function bind(d: LedgerDeps, input: {
    userId: string;
    code: string;
    tx?: FxQueryable;
    afterCommit?: (run: () => Promise<void>) => void;
}): Promise<FxBindResult>;
/** 推广人领自己的邀请码:人人可推广时谁都能领;否则只有后台设了等级的人能领(NOT_ELIGIBLE) */
export declare function ensureCode(d: LedgerDeps, userId: string, tx?: FxQueryable): Promise<FxMember>;
export interface SetMemberInput {
    userId: string;
    /** undefined = 不改;null = 取消等级(变回普通用户) */
    tierCode?: string | null;
    enabled?: boolean;
    rateOverride?: number[] | null;
    note?: string | null;
    /** 自定义邀请码(4~16 位大写字母数字) */
    code?: string;
    tx?: FxQueryable;
}
export declare function setMember(d: LedgerDeps, input: SetMemberInput): Promise<FxMember>;
/** 后台改挂上级(parentUserId=null 摘成顶层)。挂到自己的下级下面会成环,拒绝(CYCLE) */
export declare function moveMember(d: LedgerDeps, input: {
    userId: string;
    parentUserId: string | null;
    tx?: FxQueryable;
}): Promise<FxMember>;