/**
 * 提现:推广人申请(从可提现转到提现中,按规则算手续费)→ 后台审核:paid = 财务已线下打款(只记账),
 * rejected = 退回可提现。包不打款。
 */
import { audit, bump, run } from "./core.js";
import { releaseDue } from "./ledger.js";
import { withdrawalFee } from "./policy.js";
import { rows, toWithdrawal, WITHDRAWAL_COLS } from "./sql.js";
import { FenxiaoError, FxErrorCodes } from "./types.js";
function cleanPayee(p) {
    const out = { method: String(p.method ?? "").trim(), account: String(p.account ?? "").trim(), name: String(p.name ?? "").trim() };
    if (!out.method || !out.account || !out.name || out.method.length > 20 || out.account.length > 100 || out.name.length > 50) {
        throw new FenxiaoError(FxErrorCodes.INPUT_INVALID, "收款方式、账号、姓名都要填(账号 ≤100 字,姓名 ≤50 字)");
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
    const fee = withdrawalFee(policy, input.amount);
    if (fee >= input.amount)
        throw new FenxiaoError(FxErrorCodes.AMOUNT_INVALID, "金额不够扣手续费");
    await releaseDue(d, { userId: input.userId, ...(input.tx ? { tx: input.tx } : {}), ...(input.afterCommit ? { afterCommit: input.afterCommit } : {}) });
    return run(d, input, async (q, events) => {
        const acc = await rows(q, `SELECT available FROM ${d.t.accounts} WHERE user_id = $1 FOR UPDATE`, [input.userId]);
        const available = BigInt(String(acc[0]?.available ?? 0));
        if (available < input.amount)
            throw new FenxiaoError(FxErrorCodes.INSUFFICIENT_BALANCE, "可提现余额不足");
        await bump(q, d.t, input.userId, { available: -input.amount, withdrawing: input.amount });
        const r = await rows(q, `INSERT INTO ${d.t.withdrawals} (user_id, amount, fee, status, payee, created_at) VALUES ($1, $2::bigint, $3::bigint, 'pending', $4::jsonb, $5) RETURNING ${WITHDRAWAL_COLS}`, [input.userId, String(input.amount), String(fee), JSON.stringify(payee), d.now()]);
        const w = toWithdrawal(r[0] ?? {});
        events.push({ type: "withdrawal.requested", withdrawal: w });
        return w;
    });
}
/** 后台审核:paid = 财务已线下打款(只记账;账户的已提现记申请金额 amount,手续费见提现单 fee,实付 = net);rejected = 退回可提现(驳回必须写原因) */
export async function reviewWithdrawal(d, input) {
    const note = input.note?.trim().slice(0, 200) || null;
    if (input.action === "rejected" && !note)
        throw new FenxiaoError(FxErrorCodes.INPUT_INVALID, "驳回要写原因(推广人能看到)");
    return run(d, input, async (q, events) => {
        const cur = await rows(q, `SELECT ${WITHDRAWAL_COLS} FROM ${d.t.withdrawals} WHERE id = $1::bigint FOR UPDATE`, [String(input.id)]);
        const w = cur[0] ? toWithdrawal(cur[0]) : null;
        if (!w)
            throw new FenxiaoError(FxErrorCodes.NOT_FOUND, "提现单不存在");
        if (w.status !== "pending")
            throw new FenxiaoError(FxErrorCodes.ALREADY_CLOSED, "提现单已处理过");
        await bump(q, d.t, w.userId, input.action === "paid" ? { withdrawing: -w.amount, withdrawn: w.amount } : { withdrawing: -w.amount, available: w.amount });
        const r = await rows(q, `UPDATE ${d.t.withdrawals} SET status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = $5 WHERE id = $1::bigint RETURNING ${WITHDRAWAL_COLS}`, [String(w.id), input.action, note, input.operatorId, d.now()]);
        const out = toWithdrawal(r[0] ?? {});
        await audit(q, d, { actorId: input.operatorId, action: `withdrawal.${input.action}`, targetUserId: w.userId, detail: { id: w.id, amount: w.amount, fee: w.fee, note } });
        events.push({ type: "withdrawal.reviewed", withdrawal: out });
        return out;
    });
}
