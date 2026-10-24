/**
 * PostgreSQL 底座:查询器形状、表名、事务、行映射。不绑 ORM,宿主给 `query(text, values)` 即可
 * (node-postgres Pool / PoolClient、Prisma 包一层、PGlite …)。
 */
import { FenxiaoError, FxErrorCodes, } from "./types.js";
export const DEFAULT_TABLES = {
    members: "fx_members",
    commissions: "fx_commissions",
    accounts: "fx_accounts",
    withdrawals: "fx_withdrawals",
    applications: "fx_applications",
    audit: "fx_audit",
    sources: "fx_sources",
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
const json = (v) => (typeof v === "string" ? JSON.parse(v) : v);
function numArrayOrNull(v) {
    const parsed = json(v);
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
export const COMMISSION_COLS = "id, source_kind, source_ref, buyer_user_id, beneficiary_user_id, level, base_amount, rate_bps, amount, status, product_key, available_at, hold_reason, reversed_at, reverse_reason, note, created_at";
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
        productKey: strOrNull(r.product_key),
        availableAt: date(r.available_at),
        holdReason: strOrNull(r.hold_reason),
        reversedAt: dateOrNull(r.reversed_at),
        reverseReason: strOrNull(r.reverse_reason),
        note: strOrNull(r.note),
        createdAt: date(r.created_at),
    };
}
export function toAccount(userId, r) {
    return {
        userId,
        frozen: big(r?.frozen),
        held: big(r?.held),
        available: big(r?.available),
        withdrawing: big(r?.withdrawing),
        withdrawn: big(r?.withdrawn),
        earned: big(r?.earned),
        reversed: big(r?.reversed),
    };
}
export const WITHDRAWAL_COLS = "id, user_id, amount, fee, status, payee, admin_note, reviewed_by, created_at, reviewed_at";
export function toWithdrawal(r) {
    const p = json(r.payee);
    const amount = big(r.amount);
    const fee = big(r.fee);
    return {
        id: big(r.id),
        userId: String(r.user_id),
        amount,
        fee,
        net: amount - fee,
        status: String(r.status),
        payee: { method: String(p?.method ?? ""), account: String(p?.account ?? ""), name: String(p?.name ?? "") },
        adminNote: strOrNull(r.admin_note),
        reviewedBy: strOrNull(r.reviewed_by),
        createdAt: date(r.created_at),
        reviewedAt: dateOrNull(r.reviewed_at),
    };
}
export const APPLICATION_COLS = "id, user_id, status, message, admin_note, reviewed_by, created_at, reviewed_at";
export function toApplication(r) {
    return {
        id: big(r.id),
        userId: String(r.user_id),
        status: String(r.status),
        message: strOrNull(r.message),
        adminNote: strOrNull(r.admin_note),
        reviewedBy: strOrNull(r.reviewed_by),
        createdAt: date(r.created_at),
        reviewedAt: dateOrNull(r.reviewed_at),
    };
}
export function toAudit(r) {
    const detail = json(r.detail);
    return {
        id: big(r.id),
        actorId: String(r.actor_id),
        action: String(r.action),
        targetUserId: strOrNull(r.target_user_id),
        detail: typeof detail === "object" && detail !== null ? detail : {},
        createdAt: date(r.created_at),
    };
}
/** 分页参数收窄:limit 1~100(默认 20),offset ≥ 0 */
export function page(p) {
    const l = Number.isFinite(p?.limit) ? Math.floor(Number(p?.limit)) : 20;
    const o = Number.isFinite(p?.offset) ? Math.floor(Number(p?.offset)) : 0;
    return { limit: Math.min(100, Math.max(1, l)), offset: Math.min(1_000_000, Math.max(0, o)) };
}
