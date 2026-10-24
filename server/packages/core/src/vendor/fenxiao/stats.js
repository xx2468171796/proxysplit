import { rows } from "./sql.js";
export async function teamStats(d, userId) {
    const r = await rows(d.db, `SELECT
       (SELECT count(*) FROM ${d.t.members} WHERE parent_user_id = $1)::int AS direct,
       (SELECT count(*) FROM ${d.t.members} WHERE ancestors @> ARRAY[$1]::text[])::int AS team,
       (SELECT count(DISTINCT source_ref) FROM ${d.t.commissions} WHERE beneficiary_user_id = $1 AND source_kind <> 'adjust' AND status <> 'reversed')::int AS paid_orders,
       (SELECT coalesce(sum(amount), 0) FROM ${d.t.commissions} WHERE beneficiary_user_id = $1 AND status <> 'reversed')::bigint AS total`, [userId]);
    const x = r[0] ?? {};
    return { direct: Number(x.direct ?? 0), team: Number(x.team ?? 0), paidOrders: Number(x.paid_orders ?? 0), commissionTotal: BigInt(String(x.total ?? 0)) };
}
export async function overview(d, since) {
    const r = await rows(d.db, `SELECT
       (SELECT count(*) FROM ${d.t.members} WHERE parent_user_id IS NOT NULL)::int AS bound,
       (SELECT count(*) FROM ${d.t.members} WHERE tier_code IS NOT NULL)::int AS agents,
       a.frozen, a.held, a.available, a.withdrawing, a.withdrawn, a.reversed,
       (SELECT count(*) FROM ${d.t.withdrawals} WHERE status = 'pending')::int AS pending_w,
       (SELECT count(*) FROM ${d.t.applications} WHERE status = 'pending')::int AS pending_a,
       (SELECT count(*) FROM ${d.t.commissions} WHERE status = 'held')::int AS held_c,
       p.amt AS period_amt, p.cnt AS period_cnt
     FROM (SELECT coalesce(sum(frozen),0)::bigint AS frozen, coalesce(sum(held),0)::bigint AS held, coalesce(sum(available),0)::bigint AS available,
                  coalesce(sum(withdrawing),0)::bigint AS withdrawing, coalesce(sum(withdrawn),0)::bigint AS withdrawn, coalesce(sum(reversed),0)::bigint AS reversed
           FROM ${d.t.accounts}) a,
          (SELECT coalesce(sum(amount),0)::bigint AS amt, count(*)::int AS cnt FROM ${d.t.commissions}
           WHERE created_at >= $1 AND status <> 'reversed' AND source_kind <> 'adjust') p`, [since]);
    const x = r[0] ?? {};
    const b = (k) => BigInt(String(x[k] ?? 0));
    const n = (k) => Number(x[k] ?? 0);
    return {
        boundMembers: n("bound"),
        agents: n("agents"),
        frozen: b("frozen"),
        held: b("held"),
        available: b("available"),
        withdrawing: b("withdrawing"),
        withdrawn: b("withdrawn"),
        reversed: b("reversed"),
        pendingWithdrawals: n("pending_w"),
        pendingApplications: n("pending_a"),
        heldCommissions: n("held_c"),
        periodCommission: b("period_amt"),
        periodCount: n("period_cnt"),
    };
}
/** 排行榜:since 起佣金最多的前 limit 名(≤100) */
export async function leaderboard(d, query) {
    const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 10)));
    const r = await rows(d.db, `SELECT beneficiary_user_id AS user_id, sum(amount)::bigint AS amount, count(DISTINCT source_ref)::int AS orders
     FROM ${d.t.commissions} WHERE created_at >= $1 AND status <> 'reversed' AND source_kind <> 'adjust'
     GROUP BY beneficiary_user_id ORDER BY sum(amount) DESC, beneficiary_user_id LIMIT $2`, [query.since, limit]);
    return r.map((x) => ({ userId: String(x.user_id), amount: BigInt(String(x.amount)), orders: Number(x.orders) }));
}
