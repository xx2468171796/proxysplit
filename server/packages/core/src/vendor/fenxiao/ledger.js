/**
 * 记账链路:结算(含商品规则、复购限制、风控挂起)→ 冻结到期转可提现 → 退款冲回。
 * 全部在事务里跑,余额(fx_accounts)与流水(fx_commissions)同事务变,对不上的状态不会被提交。
 * 账户行一律按 user id 升序加锁(结算 / 释放 / 冲回 / 复核同序),并发时不互相死锁。
 */
import { computeShares } from "./compute.js";
import { bump, cmp, run } from "./core.js";
import { BPS, productRule, ratesFor } from "./policy.js";
import { COMMISSION_COLS, MEMBER_COLS, rows, toAccount, toCommission, toMember } from "./sql.js";
/** 买家的上级链(截到 maxLevels)连同每人此刻能拿的比例 */
async function chainOf(q, d, policy, ancestors) {
    const ids = ancestors.slice(0, policy.maxLevels);
    const found = (await rows(q, `SELECT ${MEMBER_COLS} FROM ${d.t.members} WHERE user_id = ANY($1::text[])`, [ids])).map(toMember);
    const ups = new Map(found.map((m) => [m.userId, m]));
    return ids.map((userId) => {
        const m = ups.get(userId);
        return { userId, rates: m ? ratesFor(policy, m) : null };
    });
}
/** 复购限制:绑定后超过 withinDays 天,或这个买家已返过 maxOrders 单 → 不返 */
async function overRecurring(q, d, policy, buyer, sourceKind) {
    const { maxOrders, withinDays } = policy.recurring;
    if (withinDays > 0 && buyer.boundAt && d.now().getTime() - buyer.boundAt.getTime() > withinDays * 86_400_000)
        return true;
    if (maxOrders <= 0)
        return false;
    const r = await rows(q, `SELECT count(DISTINCT source_ref)::int AS n FROM ${d.t.commissions} WHERE buyer_user_id = $1 AND source_kind = $2 AND status <> 'reversed'`, [buyer.userId, sourceKind]);
    return Number(r[0]?.n ?? 0) >= maxOrders;
}
async function holdReasonFor(q, d, policy, input, shares) {
    if (policy.holdAbove > 0n && input.baseAmount > policy.holdAbove)
        return "大额订单待复核";
    if (!d.risk)
        return null;
    const reason = await d.risk({
        buyerUserId: input.buyerUserId,
        beneficiaryUserIds: shares.map((s) => s.userId),
        baseAmount: input.baseAmount,
        sourceKind: input.sourceKind,
        sourceRef: input.sourceRef,
        productKey: input.productKey ?? null,
        tx: q,
    });
    return reason ? reason.slice(0, 200) : null;
}
const deltaFor = (status, amount) => status === "held" ? { held: amount, earned: amount } : status === "frozen" ? { frozen: amount, earned: amount } : { available: amount, earned: amount };
/** 逐份落佣金流水 + 加余额;唯一约束撞上的(并发重放)跳过 */
async function writeShares(q, d, policy, input, shares, holdReason) {
    const now = d.now();
    const availableAt = new Date(now.getTime() + policy.freezeDays * 86_400_000);
    const status = holdReason ? "held" : policy.freezeDays > 0 ? "frozen" : "available";
    const snapshot = JSON.stringify({ mode: policy.mode, maxLevels: policy.maxLevels, totalCapBps: policy.totalCapBps, freezeDays: policy.freezeDays });
    const created = [];
    for (const s of [...shares].sort((a, b) => cmp(a.userId, b.userId))) {
        const r = await rows(q, `INSERT INTO ${d.t.commissions} (source_kind, source_ref, buyer_user_id, beneficiary_user_id, level, base_amount, rate_bps, amount, status, product_key, available_at, hold_reason, policy_snapshot, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8::bigint, $9, $10, $11, $12, $13::jsonb, $14)
       ON CONFLICT (source_kind, source_ref, beneficiary_user_id) DO NOTHING RETURNING ${COMMISSION_COLS}`, [input.sourceKind, input.sourceRef, input.buyerUserId, s.userId, s.level, String(input.baseAmount), s.rateBps, String(s.amount), status, input.productKey ?? null, availableAt, holdReason, snapshot, now]);
        const row = r[0];
        if (!row)
            continue;
        created.push(toCommission(row));
        await bump(q, d.t, s.userId, deltaFor(status, s.amount));
    }
    return created.sort((a, b) => a.level - b.level);
}
/**
 * 占来源登记行(主键 = 来源)。并发的结算 / 退款在这一行上排队:
 * 已被退款登记 → REVERSED(退款先到,后到的结算不再发);已结算过 → DUPLICATE;占到了 → null。
 * 升级前的老佣金没有登记行,再查一次流水兜底。
 */
async function claimSource(q, d, kind, ref) {
    const won = await rows(q, `INSERT INTO ${d.t.sources} (source_kind, source_ref, state, updated_at) VALUES ($1, $2, 'settled', $3)
     ON CONFLICT (source_kind, source_ref) DO NOTHING RETURNING state`, [kind, ref, d.now()]);
    if (!won[0]) {
        const cur = await rows(q, `SELECT state FROM ${d.t.sources} WHERE source_kind = $1 AND source_ref = $2`, [kind, ref]);
        return cur[0]?.state === "reversed" ? "REVERSED" : "DUPLICATE";
    }
    const old = await rows(q, `SELECT 1 FROM ${d.t.commissions} WHERE source_kind = $1 AND source_ref = $2 LIMIT 1`, [kind, ref]);
    return old.length > 0 ? "DUPLICATE" : null;
}
async function plan(q, d, policy, input) {
    // 锁买家行:同一买家的并发结算排队,复购限制不会被同时突破
    const buyer = (await rows(q, `SELECT ${MEMBER_COLS} FROM ${d.t.members} WHERE user_id = $1 FOR UPDATE`, [input.buyerUserId])).map(toMember)[0];
    if (!buyer || buyer.ancestors.length === 0)
        return { skip: "NOT_REFERRED" };
    if (input.baseAmount < policy.minBaseAmount)
        return { skip: "BELOW_MIN" };
    const rule = productRule(policy, input.productKey);
    if (rule?.excluded)
        return { skip: "EXCLUDED" };
    const claimed = await claimSource(q, d, input.sourceKind, input.sourceRef);
    if (claimed)
        return { skip: claimed };
    if (await overRecurring(q, d, policy, buyer, input.sourceKind))
        return { skip: "RECURRING_LIMIT" };
    const shares = computeShares(await chainOf(q, d, policy, buyer.ancestors), input.baseAmount, policy, rule?.multiplierBps ?? BPS);
    return shares.length === 0 ? { skip: "ZERO" } : { shares, buyer };
}
/** 付款结算:在宿主履约事务里调(传 tx)。不抛业务错:不返的情况返回 reason */
export async function settle(d, input) {
    const policy = await d.policy(input.tx);
    if (!policy.enabled)
        return { settled: false, reason: "DISABLED" };
    const full = { ...input, sourceKind: input.sourceKind ?? "order" };
    return run(d, input, async (q, events) => {
        const p = await plan(q, d, policy, full);
        if ("skip" in p)
            return { settled: false, reason: p.skip };
        const created = await writeShares(q, d, policy, full, p.shares, await holdReasonFor(q, d, policy, full, p.shares));
        if (created.length === 0)
            return { settled: false, reason: "DUPLICATE" };
        events.push({ type: "commission.created", commissions: created });
        return { settled: true, commissions: created };
    });
}
const reverseDelta = (prev, amt) => prev === "frozen" ? { frozen: -amt, reversed: amt } : prev === "held" ? { held: -amt, reversed: amt } : { available: -amt, reversed: amt };
/** 退款冲回:这一来源下没冲过的佣金全部作废;已转可提现的从可提现扣(可能扣成负数 = 欠款,后续佣金先抵) */
export async function reverse(d, input) {
    const sourceKind = input.sourceKind ?? "order";
    const reason = input.reason.slice(0, 200);
    return run(d, input, async (q, events) => {
        // 先登记「已退款」:正在进行的结算会让这里等它提交;退款先到时,后到的结算看到登记就不发
        await q.query(`INSERT INTO ${d.t.sources} (source_kind, source_ref, state, reason, updated_at) VALUES ($1, $2, 'reversed', $3, $4)
       ON CONFLICT (source_kind, source_ref) DO UPDATE SET state = 'reversed', reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at`, [sourceKind, input.sourceRef, reason, d.now()]);
        const changed = await rows(q, `WITH old AS (
         SELECT id, status FROM ${d.t.commissions}
         WHERE source_kind = $1 AND source_ref = $2 AND status <> 'reversed' FOR UPDATE)
       UPDATE ${d.t.commissions} c SET status = 'reversed', reversed_at = $3, reverse_reason = $4
       FROM old WHERE c.id = old.id
       RETURNING c.beneficiary_user_id, c.amount, old.status AS prev`, [sourceKind, input.sourceRef, d.now(), reason]);
        const items = [];
        changed.sort((a, b) => cmp(String(a.beneficiary_user_id), String(b.beneficiary_user_id)));
        for (const r of changed) {
            const item = { userId: String(r.beneficiary_user_id), amount: BigInt(String(r.amount)) };
            items.push(item);
            await bump(q, d.t, item.userId, reverseDelta(String(r.prev), item.amount));
        }
        const amount = items.reduce((s, i) => s + i.amount, 0n);
        if (items.length > 0)
            events.push({ type: "commission.reversed", sourceKind, sourceRef: input.sourceRef, reason, items, amount });
        return { count: items.length, amount };
    });
}
/** 冻结期到了的佣金转可提现。宿主定时调(每几分钟一次,幂等,可多实例并发);查余额时也会先给这个人跑一次 */
export async function releaseDue(d, opts = {}) {
    const limit = Math.min(5000, Math.max(1, opts.limit ?? 500));
    return run(d, opts, async (q, events) => {
        const released = await rows(q, `WITH due AS (
         SELECT id FROM ${d.t.commissions}
         WHERE status = 'frozen' AND available_at <= $1 AND ($2::text IS NULL OR beneficiary_user_id = $2)
         ORDER BY available_at LIMIT $3 FOR UPDATE SKIP LOCKED)
       UPDATE ${d.t.commissions} c SET status = 'available' FROM due WHERE c.id = due.id
       RETURNING c.beneficiary_user_id, c.amount`, [d.now(), opts.userId ?? null, limit]);
        const per = new Map();
        for (const r of released) {
            const u = String(r.beneficiary_user_id);
            per.set(u, (per.get(u) ?? 0n) + BigInt(String(r.amount)));
        }
        const items = [...per.entries()].map(([userId, amount]) => ({ userId, amount })).sort((a, b) => cmp(a.userId, b.userId));
        for (const i of items)
            await bump(q, d.t, i.userId, { frozen: -i.amount, available: i.amount });
        if (items.length > 0)
            events.push({ type: "commission.released", items });
        return released.length;
    });
}
export async function account(d, userId) {
    await releaseDue(d, { userId });
    const r = await rows(d.db, `SELECT * FROM ${d.t.accounts} WHERE user_id = $1`, [userId]);
    return toAccount(userId, r[0]);
}
