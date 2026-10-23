/**
 * 记账链路:结算 → 冻结到期转可提现 → 退款冲回 → 提现申请 / 审核。全部在事务里跑,余额(fx_accounts)
 * 与流水(fx_commissions / fx_withdrawals)同事务变,对不上的状态不会被提交。
 */
import { computeShares, ratesFor, assertFxPolicy } from "./compute.js";
import { COMMISSION_COLS, MEMBER_COLS, WITHDRAWAL_COLS, inTx, rows, toAccount, toCommission, toMember, toWithdrawal, } from "./sql.js";
import { FenxiaoError, FxErrorCodes, } from "./types.js";
/** 账户加减:一行 upsert,行锁顺带拿到;deltas 是 列名 → 增量 */
async function bump(q, t, userId, deltas) {
    const cols = Object.keys(deltas);
    if (cols.length === 0)
        return;
    const vals = cols.map((c) => String(deltas[c] ?? 0n));
    const insertCols = cols.join(", ");
    const insertVals = cols.map((_, i) => `$${i + 2}::bigint`).join(", ");
    const sets = cols.map((c, i) => `${c} = ${t.accounts}.${c} + $${i + 2}::bigint`).join(", ");
    await q.query(`INSERT INTO ${t.accounts} (user_id, ${insertCols}) VALUES ($1, ${insertVals})
     ON CONFLICT (user_id) DO UPDATE SET ${sets}, updated_at = now()`, [userId, ...vals]);
}
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
/** 逐份落佣金流水 + 加余额;唯一约束撞上的(并发重放)跳过 */
async function writeShares(q, d, policy, input, shares) {
    const now = d.now();
    const availableAt = new Date(now.getTime() + policy.freezeDays * 86_400_000);
    const frozen = policy.freezeDays > 0;
    const snapshot = JSON.stringify({ mode: policy.mode, maxLevels: policy.maxLevels, totalCapBps: policy.totalCapBps, freezeDays: policy.freezeDays });
    const created = [];
    for (const s of shares) {
        const r = await rows(q, `INSERT INTO ${d.t.commissions} (source_kind, source_ref, buyer_user_id, beneficiary_user_id, level, base_amount, rate_bps, amount, status, available_at, policy_snapshot, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8::bigint, $9, $10, $11::jsonb, $12)
       ON CONFLICT (source_kind, source_ref, beneficiary_user_id) DO NOTHING RETURNING ${COMMISSION_COLS}`, [input.sourceKind, input.sourceRef, input.buyerUserId, s.userId, s.level, String(input.baseAmount), s.rateBps, String(s.amount), frozen ? "frozen" : "available", availableAt, snapshot, now]);
        const row = r[0];
        if (!row)
            continue;
        created.push(toCommission(row));
        await bump(q, d.t, s.userId, frozen ? { frozen: s.amount, earned: s.amount } : { available: s.amount, earned: s.amount });
    }
    return created;
}
export async function settle(d, input) {
    const policy = await d.policy(input.tx);
    assertFxPolicy(policy);
    if (!policy.enabled)
        return { settled: false, reason: "DISABLED" };
    const sourceKind = input.sourceKind ?? "order";
    return inTx(d.db, input.tx, async (q) => {
        const buyer = (await rows(q, `SELECT ${MEMBER_COLS} FROM ${d.t.members} WHERE user_id = $1`, [input.buyerUserId])).map(toMember)[0];
        if (!buyer || buyer.ancestors.length === 0)
            return { settled: false, reason: "NOT_REFERRED" };
        if (input.baseAmount < policy.minBaseAmount)
            return { settled: false, reason: "BELOW_MIN" };
        const dup = await rows(q, `SELECT 1 FROM ${d.t.commissions} WHERE source_kind = $1 AND source_ref = $2 LIMIT 1`, [sourceKind, input.sourceRef]);
        if (dup.length > 0)
            return { settled: false, reason: "DUPLICATE" };
        const shares = computeShares(await chainOf(q, d, policy, buyer.ancestors), input.baseAmount, policy);
        if (shares.length === 0)
            return { settled: false, reason: "ZERO" };
        const created = await writeShares(q, d, policy, { ...input, sourceKind }, shares);
        if (created.length === 0)
            return { settled: false, reason: "DUPLICATE" };
        d.emit({ type: "commission.created", commissions: created }, input.afterCommit);
        return { settled: true, commissions: created };
    });
}
/** 退款冲回:这一来源下没冲过的佣金全部作废;已转可提现的从可提现扣(可能扣成负数 = 欠款,后续佣金先抵) */
export async function reverse(d, input) {
    const sourceKind = input.sourceKind ?? "order";
    return inTx(d.db, input.tx, async (q) => {
        const changed = await rows(q, `WITH old AS (
         SELECT id, status FROM ${d.t.commissions}
         WHERE source_kind = $1 AND source_ref = $2 AND status <> 'reversed' FOR UPDATE)
       UPDATE ${d.t.commissions} c SET status = 'reversed', reversed_at = $3, reverse_reason = $4
       FROM old WHERE c.id = old.id
       RETURNING c.beneficiary_user_id, c.amount, old.status AS prev`, [sourceKind, input.sourceRef, d.now(), input.reason.slice(0, 200)]);
        let amount = 0n;
        for (const r of changed) {
            const amt = BigInt(String(r.amount));
            amount += amt;
            await bump(q, d.t, String(r.beneficiary_user_id), r.prev === "frozen" ? { frozen: -amt, reversed: amt } : { available: -amt, reversed: amt });
        }
        if (changed.length > 0)
            d.emit({ type: "commission.reversed", sourceKind, sourceRef: input.sourceRef, count: changed.length, amount }, input.afterCommit);
        return { count: changed.length, amount };
    });
}
/** 冻结期到了的佣金转可提现。宿主定时调(每几分钟一次);查余额时也会先给这个人跑一次 */
export async function releaseDue(d, opts = {}) {
    const limit = Math.min(5000, Math.max(1, opts.limit ?? 500));
    return inTx(d.db, opts.tx, async (q) => {
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
        for (const [u, amt] of [...per.entries()].sort(([a], [b]) => a.localeCompare(b)))
            await bump(q, d.t, u, { frozen: -amt, available: amt });
        return released.length;
    });
}
export async function account(d, userId) {
    await releaseDue(d, { userId });
    const r = await rows(d.db, `SELECT * FROM ${d.t.accounts} WHERE user_id = $1`, [userId]);
    return toAccount(userId, r[0]);
}
function cleanPayee(p) {
    const out = { method: String(p.method ?? "").trim(), account: String(p.account ?? "").trim(), name: String(p.name ?? "").trim() };
    if (!out.method || !out.account || !out.name || out.method.length > 20 || out.account.length > 100 || out.name.length > 50) {
        throw new FenxiaoError(FxErrorCodes.AMOUNT_INVALID, "收款方式、账号、姓名都要填(账号 ≤100 字,姓名 ≤50 字)");
    }
    return out;
}
export async function requestWithdrawal(d, input) {
    const policy = await d.policy(input.tx);
    if (input.amount <= 0n)
        throw new FenxiaoError(FxErrorCodes.AMOUNT_INVALID, "提现金额必须大于 0");
    if (input.amount < policy.minWithdrawal)
        throw new FenxiaoError(FxErrorCodes.BELOW_MIN_WITHDRAWAL, "低于最低提现金额");
    const payee = cleanPayee(input.payee);
    await releaseDue(d, { userId: input.userId, ...(input.tx ? { tx: input.tx } : {}) });
    return inTx(d.db, input.tx, async (q) => {
        const acc = await rows(q, `SELECT available FROM ${d.t.accounts} WHERE user_id = $1 FOR UPDATE`, [input.userId]);
        const available = BigInt(String(acc[0]?.available ?? 0));
        if (available < input.amount)
            throw new FenxiaoError(FxErrorCodes.INSUFFICIENT_BALANCE, "可提现余额不足");
        await bump(q, d.t, input.userId, { available: -input.amount, withdrawing: input.amount });
        const r = await rows(q, `INSERT INTO ${d.t.withdrawals} (user_id, amount, status, payee, created_at) VALUES ($1, $2::bigint, 'pending', $3::jsonb, $4) RETURNING ${WITHDRAWAL_COLS}`, [input.userId, String(input.amount), JSON.stringify(payee), d.now()]);
        const w = toWithdrawal(r[0] ?? {});
        d.emit({ type: "withdrawal.requested", withdrawal: w }, input.afterCommit);
        return w;
    });
}
/** 后台审核:paid = 财务已线下打款(只记账);rejected = 退回可提现 */
export async function reviewWithdrawal(d, input) {
    return inTx(d.db, input.tx, async (q) => {
        const cur = await rows(q, `SELECT ${WITHDRAWAL_COLS} FROM ${d.t.withdrawals} WHERE id = $1::bigint FOR UPDATE`, [String(input.id)]);
        const w = cur[0] ? toWithdrawal(cur[0]) : null;
        if (!w)
            throw new FenxiaoError(FxErrorCodes.NOT_FOUND, "提现单不存在");
        if (w.status !== "pending")
            throw new FenxiaoError(FxErrorCodes.WITHDRAWAL_CLOSED, "提现单已处理过");
        await bump(q, d.t, w.userId, input.action === "paid" ? { withdrawing: -w.amount, withdrawn: w.amount } : { withdrawing: -w.amount, available: w.amount });
        const r = await rows(q, `UPDATE ${d.t.withdrawals} SET status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = $5 WHERE id = $1::bigint RETURNING ${WITHDRAWAL_COLS}`, [String(input.id), input.action, input.note?.slice(0, 200) ?? null, input.operatorId, d.now()]);
        const out = toWithdrawal(r[0] ?? {});
        d.emit({ type: "withdrawal.reviewed", withdrawal: out });
        return out;
    });
}
