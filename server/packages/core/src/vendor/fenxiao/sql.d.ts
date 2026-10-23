/**
 * fenxiao 的 PostgreSQL 底座:查询器形状、表名、事务、行映射。不绑 ORM,宿主给 `query(text, values)` 即可
 * (node-postgres Pool / PoolClient、Prisma 包一层、PGlite …)。
 */
import { type FxCommission, type FxMember, type FxAccount, type FxWithdrawal } from "./types.ts";
export interface FxQueryable {
    query(text: string, values?: unknown[]): Promise<{
        rows: unknown[];
    }>;
}
export type Row = Record<string, unknown>;
export interface FxTables {
    members: string;
    commissions: string;
    accounts: string;
    withdrawals: string;
}
export declare const DEFAULT_TABLES: FxTables;
/** 表名只来自宿主配置,但仍按标识符白名单校验 —— 拼进 SQL 的东西永远先验 */
export declare function resolveTables(t?: Partial<FxTables>): FxTables;
export declare function rows(q: FxQueryable, text: string, values?: unknown[]): Promise<Row[]>;
/**
 * 传了 tx 就在宿主事务里跑;没传就自开一个(pg Pool → connect + BEGIN;PGlite / 自带 transaction() 的驱动 → 用它)。
 * 两样都没有就报错:多步记账不允许无事务跑(余额与流水会对不上)。
 */
export declare function inTx<T>(db: FxQueryable, tx: FxQueryable | undefined, fn: (q: FxQueryable) => Promise<T>): Promise<T>;
export declare const MEMBER_COLS = "user_id, parent_user_id, ancestors, code, tier_code, enabled, rate_override, note, bound_at, created_at, updated_at";
export declare function toMember(r: Row): FxMember;
export declare const COMMISSION_COLS = "id, source_kind, source_ref, buyer_user_id, beneficiary_user_id, level, base_amount, rate_bps, amount, status, available_at, reversed_at, reverse_reason, created_at";
export declare function toCommission(r: Row): FxCommission;
export declare function toAccount(userId: string, r: Row | undefined): FxAccount;
export declare const WITHDRAWAL_COLS = "id, user_id, amount, status, payee, admin_note, reviewed_by, created_at, reviewed_at";
export declare function toWithdrawal(r: Row): FxWithdrawal;
/** 分页参数收窄:limit 1~100(默认 20),offset ≥ 0 */
export declare function page(p?: {
    limit?: number;
    offset?: number;
}): {
    limit: number;
    offset: number;
};