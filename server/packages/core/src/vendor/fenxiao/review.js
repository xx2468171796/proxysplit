/**
 * 后台对佣金的人工动作:复核挂起的佣金(放行 / 作废)、手工调账(补发 / 扣减,必须写原因)。都写审计。
 */
import { audit, bump, run } from "./core.js";
import { COMMISSION_COLS, rows, toCommission } from "./sql.js";
import { FenxiaoError, FxErrorCodes } from "./types.js";
/** 复核挂起的佣金:approve = 放行(冻结期没过进冻结,过了直接可提现);void = 作废(记为冲回) */
export async function reviewCommission(d, input) {
    const note = input.note?.trim().slice(0, 200) ?? null;
    if (input.action === "void" && !note)
        throw new FenxiaoError(FxErrorCodes.INPUT_INVALID, "作废要写原因");
    return run(d, input, async (q, events) => {
        const cur = await rows(q, `SELECT ${COMMISSION_COLS} FROM ${d.t.commissions} WHERE id = $1::bigint FOR UPDATE`, [String(input.id)]);
        const c = cur[0] ? toCommission(cur[0]) : null;
        if (!c)
            throw new FenxiaoError(FxErrorCodes.NOT_FOUND, "佣金记录不存在");
        if (c.status !== "held")
            throw new FenxiaoError(FxErrorCodes.ALREADY_CLOSED, "这笔佣金不在待复核状态");
        let next;
        if (input.action === "void")
            next = "reversed";
        else
            next = c.availableAt.getTime() > d.now().getTime() ? "frozen" : "available";
        const r = await rows(q, `UPDATE ${d.t.commissions} SET status = $2, note = coalesce($3, note),
         reversed_at = CASE WHEN $2 = 'reversed' THEN $4 ELSE reversed_at END,
         reverse_reason = CASE WHEN $2 = 'reversed' THEN $3 ELSE reverse_reason END
       WHERE id = $1::bigint RETURNING ${COMMISSION_COLS}`, [String(c.id), next, note, d.now()]);
        const delta = next === "reversed" ? { held: -c.amount, reversed: c.amount } : { held: -c.amount, [next]: c.amount };
        await bump(q, d.t, c.beneficiaryUserId, delta);
        const out = toCommission(r[0] ?? {});
        await audit(q, d, { actorId: input.operatorId, action: `commission.${input.action}`, targetUserId: c.beneficiaryUserId, detail: { id: c.id, amount: c.amount, note } });
        events.push({ type: "commission.reviewed", commission: out, action: input.action, operatorId: input.operatorId });
        return out;
    });
}
/** 手工调账:落一条 sourceKind=adjust 的流水,余额即时变 */
export async function adjust(d, input) {
    const reason = input.reason.trim().slice(0, 200);
    if (!reason)
        throw new FenxiaoError(FxErrorCodes.INPUT_INVALID, "调账要写原因");
    if (input.amount === 0n)
        throw new FenxiaoError(FxErrorCodes.AMOUNT_INVALID, "调账金额不能为 0");
    const ref = input.ref?.trim().slice(0, 64) || `adj-${d.now().getTime()}-${crypto.randomUUID().slice(0, 8)}`;
    return run(d, input, async (q, events) => {
        const now = d.now();
        const r = await rows(q, `INSERT INTO ${d.t.commissions} (source_kind, source_ref, buyer_user_id, beneficiary_user_id, level, base_amount, rate_bps, amount, status, available_at, note, policy_snapshot, created_at)
       VALUES ('adjust', $1, $2, $2, 0, 0, 0, $3::bigint, 'available', $4, $5, '{}'::jsonb, $4)
       ON CONFLICT (source_kind, source_ref, beneficiary_user_id) DO NOTHING RETURNING ${COMMISSION_COLS}`, [ref, input.userId, String(input.amount), now, reason]);
        if (!r[0])
            throw new FenxiaoError(FxErrorCodes.ALREADY_CLOSED, `调账单 ${ref} 已经处理过`);
        const c = toCommission(r[0]);
        await bump(q, d.t, input.userId, input.amount > 0n ? { available: input.amount, earned: input.amount } : { available: input.amount, reversed: -input.amount });
        await audit(q, d, { actorId: input.operatorId, action: "commission.adjust", targetUserId: input.userId, detail: { ref, amount: input.amount, reason } });
        events.push({ type: "commission.adjusted", commission: c, operatorId: input.operatorId });
        return c;
    });
}
