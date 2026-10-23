/**
 * 只读查询:成员 / 下级 / 佣金 / 提现列表(全部分页,limit ≤100)与总览统计。
 * WHERE 只由固定片段拼接,值全部走参数。
 */
import { COMMISSION_COLS, MEMBER_COLS, WITHDRAWAL_COLS, page, rows, toAccount, toCommission, toMember, toWithdrawal } from "./sql.js";
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
    next() {
        return `$${this.vals.length + 1}`;
    }
}
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
    const lp = w.next();
    const r = await rows(d.db, `SELECT ${MEMBER_COLS.split(", ").map((c) => `m.${c}`).join(", ")},
       (SELECT count(*) FROM ${d.t.members} x WHERE x.parent_user_id = m.user_id)::int AS direct_count,
       (SELECT count(*) FROM ${d.t.members} x WHERE x.ancestors @> ARRAY[m.user_id]::text[])::int AS team_count,
       a.frozen, a.available, a.withdrawing, a.withdrawn, a.earned, a.reversed,
       count(*) OVER()::int AS total_count
     FROM ${d.t.members} m LEFT JOIN ${d.t.accounts} a ON a.user_id = m.user_id
     ${w.sql()} ORDER BY coalesce(a.earned, 0) DESC, m.created_at DESC LIMIT ${lp} OFFSET $${w.vals.length + 2}`, [...w.vals, limit, offset]);
    return {
        items: r.map((x) => ({ ...toMember(x), directCount: Number(x.direct_count), teamCount: Number(x.team_count), account: toAccount(String(x.user_id), x) })),
        total: r[0] ? Number(r[0].total_count) : 0,
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
    return { items: r.map((x) => ({ ...toMember(x), depth: Number(x.depth) })), total: r[0] ? Number(r[0].total_count) : 0, limit, offset };
}
export async function listCommissions(d, query = {}) {
    const { limit, offset } = page(query);
    const w = new Where();
    if (query.beneficiaryUserId)
        w.add((p) => `beneficiary_user_id = ${p}`, query.beneficiaryUserId);
    if (query.buyerUserId)
        w.add((p) => `buyer_user_id = ${p}`, query.buyerUserId);
    if (query.status)
        w.add((p) => `status = ${p}`, query.status);
    if (query.sourceRef)
        w.add((p) => `source_ref = ${p}`, query.sourceRef);
    const r = await rows(d.db, `SELECT ${COMMISSION_COLS}, count(*) OVER()::int AS total_count, sum(amount) OVER()::bigint AS amount_sum
     FROM ${d.t.commissions} ${w.sql()} ORDER BY id DESC LIMIT ${w.next()} OFFSET $${w.vals.length + 2}`, [...w.vals, limit, offset]);
    return {
        items: r.map(toCommission),
        total: r[0] ? Number(r[0].total_count) : 0,
        amountSum: r[0] ? BigInt(String(r[0].amount_sum)) : 0n,
        limit,
        offset,
    };
}
export async function listWithdrawals(d, query = {}) {
    const { limit, offset } = page(query);
    const w = new Where();
    if (query.userId)
        w.add((p) => `user_id = ${p}`, query.userId);
    if (query.status)
        w.add((p) => `status = ${p}`, query.status);
    const r = await rows(d.db, `SELECT ${WITHDRAWAL_COLS}, count(*) OVER()::int AS total_count FROM ${d.t.withdrawals} ${w.sql()} ORDER BY id DESC LIMIT ${w.next()} OFFSET $${w.vals.length + 2}`, [...w.vals, limit, offset]);
    return { items: r.map(toWithdrawal), total: r[0] ? Number(r[0].total_count) : 0, limit, offset };
}
export async function teamStats(d, userId) {
    const r = await rows(d.db, `SELECT
       (SELECT count(*) FROM ${d.t.members} WHERE parent_user_id = $1)::int AS direct,
       (SELECT count(*) FROM ${d.t.members} WHERE ancestors @> ARRAY[$1]::text[])::int AS team,
       (SELECT count(DISTINCT source_ref) FROM ${d.t.commissions} WHERE beneficiary_user_id = $1 AND status <> 'reversed')::int AS paid_orders,
       (SELECT coalesce(sum(amount), 0) FROM ${d.t.commissions} WHERE beneficiary_user_id = $1 AND status <> 'reversed')::bigint AS total`, [userId]);
    const x = r[0] ?? {};
    return { direct: Number(x.direct ?? 0), team: Number(x.team ?? 0), paidOrders: Number(x.paid_orders ?? 0), commissionTotal: BigInt(String(x.total ?? 0)) };
}
export async function overview(d, since) {
    const r = await rows(d.db, `SELECT
       (SELECT count(*) FROM ${d.t.members} WHERE parent_user_id IS NOT NULL)::int AS bound,
       (SELECT count(*) FROM ${d.t.members} WHERE tier_code IS NOT NULL)::int AS agents,
       (SELECT coalesce(sum(frozen),0) FROM ${d.t.accounts})::bigint AS frozen,
       (SELECT coalesce(sum(available),0) FROM ${d.t.accounts})::bigint AS available,
       (SELECT coalesce(sum(withdrawing),0) FROM ${d.t.accounts})::bigint AS withdrawing,
       (SELECT coalesce(sum(withdrawn),0) FROM ${d.t.accounts})::bigint AS withdrawn,
       (SELECT coalesce(sum(reversed),0) FROM ${d.t.accounts})::bigint AS reversed,
       (SELECT count(*) FROM ${d.t.withdrawals} WHERE status = 'pending')::int AS pending_w,
       (SELECT coalesce(sum(amount),0) FROM ${d.t.commissions} WHERE created_at >= $1 AND status <> 'reversed')::bigint AS period_amt,
       (SELECT count(*) FROM ${d.t.commissions} WHERE created_at >= $1 AND status <> 'reversed')::int AS period_cnt`, [since]);
    const x = r[0] ?? {};
    const b = (k) => BigInt(String(x[k] ?? 0));
    return {
        boundMembers: Number(x.bound ?? 0),
        agents: Number(x.agents ?? 0),
        frozen: b("frozen"),
        available: b("available"),
        withdrawing: b("withdrawing"),
        withdrawn: b("withdrawn"),
        reversed: b("reversed"),
        pendingWithdrawals: Number(x.pending_w ?? 0),
        periodCommission: b("period_amt"),
        periodCount: Number(x.period_cnt ?? 0),
    };
}
