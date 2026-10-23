/**
 * fenxiao 的 PostgreSQL 底座:查询器形状、表名、事务、行映射。不绑 ORM,宿主给 `query(text, values)` 即可
 * (node-postgres Pool / PoolClient、Prisma 包一层、PGlite …)。
 */
import { FenxiaoError, FxErrorCodes } from "./types.js";
export const DEFAULT_TABLES = {
    members: "fx_members",
    commissions: "fx_commissions",
    accounts: "fx_accounts",
    withdrawals: "fx_withdrawals",
};
const IDENT_RE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;
/** 表名只来自宿主配置,但仍按标识符白名单校验 —— 拼进 SQL 的东西永远先验 */
export function resolveTables(t) {
    const out = { ...DEFAULT_TABLES, ...t };
    for (const [k, v] of Object.entries(out)) {
        if (!IDENT_RE.test(v))
            throw new FenxiaoError(FxErrorCodes.POLICY_INVALID, `表名 ${k}=${v} 不合法`);
    }
    return out;
}
export async function rows(q, text, values = []) {
    const r = await q.query(text, values);
    return r.rows.filter((x) => typeof x === "object" && x !== null);
}
const isPool = (db) => {
    const d = db;
    return typeof d.connect === "function" && typeof d.idleCount === "number" && typeof d.totalCount === "number";
};
const hasTransaction = (db) => typeof db.transaction === "function";
/**
 * 传了 tx 就在宿主事务里跑;没传就自开一个(pg Pool → connect + BEGIN;PGlite / 自带 transaction() 的驱动 → 用它)。
 * 两样都没有就报错:多步记账不允许无事务跑(余额与流水会对不上)。
 */
export async function inTx(db, tx, fn) {
    if (tx)
        return fn(tx);
    if (isPool(db)) {
        const client = await db.connect();
        try {
            await client.query("BEGIN");
            const out = await fn(client);
            await client.query("COMMIT");
            return out;
        }
        catch (e) {
            await client.query("ROLLBACK");
            throw e;
        }
        finally {
            client.release();
        }
    }
    if (hasTransaction(db))
        return db.transaction(fn);
    throw new FenxiaoError(FxErrorCodes.POLICY_INVALID, "db 既不是 pg Pool 也没有 transaction():记账操作请传 tx");
}
const big = (v) => (typeof v === "bigint" ? v : BigInt(String(v ?? 0)));
const date = (v) => (v instanceof Date ? v : new Date(String(v)));
const dateOrNull = (v) => (v === null || v === undefined ? null : date(v));
const strOrNull = (v) => (v === null || v === undefined ? null : String(v));
function numArrayOrNull(v) {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed.map(Number) : null;
}
function textArray(v) {
    if (Array.isArray(v))
        return v.map(String);
    if (typeof v === "string" && v.startsWith("{")) {
        const inner = v.slice(1, -1);
        return inner ? inner.split(",").map((s) => s.replace(/^"|"$/g, "")) : [];
    }
    return [];
}
export const MEMBER_COLS = "user_id, parent_user_id, ancestors, code, tier_code, enabled, rate_override, note, bound_at, created_at, updated_at";
export function toMember(r) {
    return {
        userId: String(r.user_id),
        parentUserId: strOrNull(r.parent_user_id),
        ancestors: textArray(r.ancestors),
        code: strOrNull(r.code),
        tierCode: strOrNull(r.tier_code),
        enabled: r.enabled === true,
        rateOverride: numArrayOrNull(r.rate_override),
        note: strOrNull(r.note),
        boundAt: dateOrNull(r.bound_at),
        createdAt: date(r.created_at),
        updatedAt: date(r.updated_at),
    };
}
export const COMMISSION_COLS = "id, source_kind, source_ref, buyer_user_id, beneficiary_user_id, level, base_amount, rate_bps, amount, status, available_at, reversed_at, reverse_reason, created_at";
export function toCommission(r) {
    return {
        id: big(r.id),
        sourceKind: String(r.source_kind),
        sourceRef: String(r.source_ref),
        buyerUserId: String(r.buyer_user_id),
        beneficiaryUserId: String(r.beneficiary_user_id),
        level: Number(r.level),
        baseAmount: big(r.base_amount),
        rateBps: Number(r.rate_bps),
        amount: big(r.amount),
        status: String(r.status),
        availableAt: date(r.available_at),
        reversedAt: dateOrNull(r.reversed_at),
        reverseReason: strOrNull(r.reverse_reason),
        createdAt: date(r.created_at),
    };
}
export function toAccount(userId, r) {
    return {
        userId,
        frozen: big(r?.frozen),
        available: big(r?.available),
        withdrawing: big(r?.withdrawing),
        withdrawn: big(r?.withdrawn),
        earned: big(r?.earned),
        reversed: big(r?.reversed),
    };
}
export const WITHDRAWAL_COLS = "id, user_id, amount, status, payee, admin_note, reviewed_by, created_at, reviewed_at";
export function toWithdrawal(r) {
    const p = (typeof r.payee === "string" ? JSON.parse(r.payee) : r.payee);
    return {
        id: big(r.id),
        userId: String(r.user_id),
        amount: big(r.amount),
        status: String(r.status),
        payee: { method: String(p?.method ?? ""), account: String(p?.account ?? ""), name: String(p?.name ?? "") },
        adminNote: strOrNull(r.admin_note),
        reviewedBy: strOrNull(r.reviewed_by),
        createdAt: date(r.created_at),
        reviewedAt: dateOrNull(r.reviewed_at),
    };
}
/** 分页参数收窄:limit 1~100(默认 20),offset ≥ 0 */
export function page(p) {
    const l = Number.isFinite(p?.limit) ? Math.floor(Number(p?.limit)) : 20;
    const o = Number.isFinite(p?.offset) ? Math.floor(Number(p?.offset)) : 0;
    return { limit: Math.min(100, Math.max(1, l)), offset: Math.max(0, o) };
}
