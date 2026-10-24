import { APPLICATION_COLS, COMMISSION_COLS, MEMBER_COLS, page, rows, toAccount, toApplication, toAudit, toCommission, toMember, toWithdrawal, WITHDRAWAL_COLS, } from "./sql.js";
class Where {
    parts = [];
    vals = [];
    add(fragment, value) {
        this.vals.push(value);
        this.parts.push(fragment(`$${this.vals.length}`));
    }
    sql() {
        return this.parts.length ? `WHERE ${this.parts.join(" AND ")}` : "";
    }
    /** 末尾追加 LIMIT / OFFSET 的占位与值 */
    paged(limit, offset) {
        const n = this.vals.length;
        return { tail: `LIMIT $${n + 1} OFFSET $${n + 2}`, vals: [...this.vals, limit, offset] };
    }
}
const total = (r) => (r[0] ? Number(r[0].total_count) : 0);
export async function listMembers(d, query = {}) {
    const { limit, offset } = page(query);
    const w = new Where();
    if (query.agentsOnly)
        w.parts.push("m.tier_code IS NOT NULL");
    if (query.tierCode)
        w.add((p) => `m.tier_code = ${p}`, query.tierCode);
    if (query.parentUserId)
        w.add((p) => `m.parent_user_id = ${p}`, query.parentUserId);
    if (query.userIds)
        w.add((p) => `m.user_id = ANY(${p}::text[])`, query.userIds);
    const pg = w.paged(limit, offset);
    const r = await rows(d.db, `SELECT ${MEMBER_COLS.split(", ")
        .map((c) => `m.${c}`)
        .join(", ")},
       (SELECT count(*) FROM ${d.t.members} x WHERE x.parent_user_id = m.user_id)::int AS direct_count,
       (SELECT count(*) FROM ${d.t.members} x WHERE x.ancestors @> ARRAY[m.user_id]::text[])::int AS team_count,
       a.frozen, a.held, a.available, a.withdrawing, a.withdrawn, a.earned, a.reversed,
       count(*) OVER()::int AS total_count
     FROM ${d.t.members} m LEFT JOIN ${d.t.accounts} a ON a.user_id = m.user_id
     ${w.sql()} ORDER BY coalesce(a.earned, 0) DESC, m.created_at DESC ${pg.tail}`, pg.vals);
    return {
        items: r.map((x) => ({ ...toMember(x), directCount: Number(x.direct_count), teamCount: Number(x.team_count), account: toAccount(String(x.user_id), x) })),
        total: total(r),
        limit,
        offset,
    };
}
/** 某人的团队(下级):level 不传 = 全部层级 */
export async function listDownline(d, query) {
    const { limit, offset } = page(query);
    const r = await rows(d.db, `SELECT ${MEMBER_COLS}, array_position(ancestors, $1)::int AS depth, count(*) OVER()::int AS total_count
     FROM ${d.t.members} WHERE ancestors @> ARRAY[$1]::text[] AND ($2::int IS NULL OR array_position(ancestors, $1) = $2)
     ORDER BY bound_at DESC NULLS LAST LIMIT $3 OFFSET $4`, [query.userId, query.level ?? null, limit, offset]);
    return { items: r.map((x) => ({ ...toMember(x), depth: Number(x.depth) })), total: total(r), limit, offset };
}
function commissionWhere(query) {
    const w = new Where();
    if (query.beneficiaryUserId)
        w.add((p) => `beneficiary_user_id = ${p}`, query.beneficiaryUserId);
    if (query.buyerUserId)
        w.add((p) => `buyer_user_id = ${p}`, query.buyerUserId);
    if (query.status)
        w.add((p) => `status = ${p}`, query.status);
    if (query.sourceKind)
        w.add((p) => `source_kind = ${p}`, query.sourceKind);
    if (query.sourceRef)
        w.add((p) => `source_ref = ${p}`, query.sourceRef);
    if (query.productKey)
        w.add((p) => `product_key = ${p}`, query.productKey);
    if (query.since)
        w.add((p) => `created_at >= ${p}`, query.since);
    return w;
}
export async function listCommissions(d, query = {}) {
    const { limit, offset } = page(query);
    const w = commissionWhere(query);
    const pg = w.paged(limit, offset);
    const r = await rows(d.db, `SELECT ${COMMISSION_COLS}, count(*) OVER()::int AS total_count, sum(amount) OVER()::bigint AS amount_sum
     FROM ${d.t.commissions} ${w.sql()} ORDER BY id DESC ${pg.tail}`, pg.vals);
    return { items: r.map(toCommission), total: total(r), amountSum: r[0] ? BigInt(String(r[0].amount_sum)) : 0n, limit, offset };
}
export async function listWithdrawals(d, query = {}) {
    const { limit, offset } = page(query);
    const w = new Where();
    if (query.userId)
        w.add((p) => `user_id = ${p}`, query.userId);
    if (query.status)
        w.add((p) => `status = ${p}`, query.status);
    const pg = w.paged(limit, offset);
    const r = await rows(d.db, `SELECT ${WITHDRAWAL_COLS}, count(*) OVER()::int AS total_count FROM ${d.t.withdrawals} ${w.sql()} ORDER BY id DESC ${pg.tail}`, pg.vals);
    return { items: r.map(toWithdrawal), total: total(r), limit, offset };
}
export async function listApplications(d, query = {}) {
    const { limit, offset } = page(query);
    const w = new Where();
    if (query.userId)
        w.add((p) => `user_id = ${p}`, query.userId);
    if (query.status)
        w.add((p) => `status = ${p}`, query.status);
    const pg = w.paged(limit, offset);
    const r = await rows(d.db, `SELECT ${APPLICATION_COLS}, count(*) OVER()::int AS total_count FROM ${d.t.applications} ${w.sql()} ORDER BY id DESC ${pg.tail}`, pg.vals);
    return { items: r.map(toApplication), total: total(r), limit, offset };
}
export async function listAudit(d, query = {}) {
    const { limit, offset } = page(query);
    const w = new Where();
    if (query.targetUserId)
        w.add((p) => `target_user_id = ${p}`, query.targetUserId);
    if (query.action)
        w.add((p) => `action = ${p}`, query.action);
    const pg = w.paged(limit, offset);
    const r = await rows(d.db, `SELECT id, actor_id, action, target_user_id, detail, created_at, count(*) OVER()::int AS total_count FROM ${d.t.audit} ${w.sql()} ORDER BY id DESC ${pg.tail}`, pg.vals);
    return { items: r.map(toAudit), total: total(r), limit, offset };
}
