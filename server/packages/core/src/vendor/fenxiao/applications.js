/**
 * 申请成为推广员:规则 application = review 时进待审,auto 时当场通过;off 时不开放(后台直接设等级)。
 * 通过 = 给 applicationTierCode 等级(没配就只开人人可推广的默认比例)并发邀请码。
 */
import { audit, run } from "./core.js";
import { assignCode, ensureRow, memberOf } from "./members.js";
import { canPromote } from "./policy.js";
import { APPLICATION_COLS, rows, toApplication } from "./sql.js";
import { FenxiaoError, FxErrorCodes } from "./types.js";
async function pendingOf(q, d, userId) {
    const r = await rows(q, `SELECT ${APPLICATION_COLS} FROM ${d.t.applications} WHERE user_id = $1 AND status = 'pending' FOR UPDATE`, [userId]);
    return r[0] ? toApplication(r[0]) : null;
}
/** 通过:给等级(已有等级的不降)+ 发码 */
async function grantOnApprove(q, d, policy, userId) {
    await ensureRow(q, d, userId);
    const me = await memberOf(q, d, userId, true);
    if (policy.applicationTierCode && !me?.tierCode) {
        // 不动 enabled:申请后被后台停用的人,通过申请也不会被悄悄重新启用
        await q.query(`UPDATE ${d.t.members} SET tier_code = $2, updated_at = now() WHERE user_id = $1`, [userId, policy.applicationTierCode]);
    }
    if (!me?.code)
        await assignCode(q, d, userId);
}
async function close(q, d, id, status, operatorId, note) {
    const r = await rows(q, `UPDATE ${d.t.applications} SET status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = $5 WHERE id = $1::bigint RETURNING ${APPLICATION_COLS}`, [String(id), status, note, operatorId, d.now()]);
    return toApplication(r[0] ?? {});
}
/** 用户申请。已有资格 → APPLICATION_CLOSED;已有待审的 → 原样返回(幂等) */
export async function apply(d, input) {
    const policy = await d.policy(input.tx);
    if (policy.application === "off")
        throw new FenxiaoError(FxErrorCodes.NOT_ELIGIBLE, "暂不开放申请");
    return run(d, input, async (q, events) => {
        const me = await memberOf(q, d, input.userId);
        if (me && !me.enabled)
            throw new FenxiaoError(FxErrorCodes.NOT_ELIGIBLE, "推广资格已停用");
        if (canPromote(policy, me))
            throw new FenxiaoError(FxErrorCodes.APPLICATION_CLOSED, "已经有推广资格了");
        // 并发重复申请:部分唯一索引兜底,撞上的那个读回已有的待审单(不报 500)
        const r = await rows(q, `INSERT INTO ${d.t.applications} (user_id, status, message, created_at) VALUES ($1, 'pending', $2, $3)
       ON CONFLICT (user_id) WHERE status = 'pending' DO NOTHING RETURNING ${APPLICATION_COLS}`, [input.userId, input.message?.trim().slice(0, 500) || null, d.now()]);
        if (!r[0]) {
            const existing = await pendingOf(q, d, input.userId);
            if (existing)
                return existing;
            throw new FenxiaoError(FxErrorCodes.APPLICATION_CLOSED, "申请刚被处理,请刷新");
        }
        let app = toApplication(r[0]);
        events.push({ type: "application.created", application: app });
        if (policy.application === "auto") {
            await grantOnApprove(q, d, policy, input.userId);
            app = await close(q, d, app.id, "approved", "system", "自动通过");
            events.push({ type: "application.reviewed", application: app });
        }
        return app;
    });
}
/** 后台审核申请 */
export async function reviewApplication(d, input) {
    const policy = await d.policy(input.tx);
    return run(d, input, async (q, events) => {
        const cur = await rows(q, `SELECT ${APPLICATION_COLS} FROM ${d.t.applications} WHERE id = $1::bigint FOR UPDATE`, [String(input.id)]);
        const app = cur[0] ? toApplication(cur[0]) : null;
        if (!app)
            throw new FenxiaoError(FxErrorCodes.NOT_FOUND, "申请不存在");
        if (app.status !== "pending")
            throw new FenxiaoError(FxErrorCodes.ALREADY_CLOSED, "申请已处理过");
        if (input.action === "approve")
            await grantOnApprove(q, d, policy, app.userId);
        const out = await close(q, d, app.id, input.action === "approve" ? "approved" : "rejected", input.operatorId, input.note?.slice(0, 200) ?? null);
        await audit(q, d, { actorId: input.operatorId, action: `application.${input.action}`, targetUserId: app.userId, detail: { id: app.id, note: out.adminNote } });
        events.push({ type: "application.reviewed", application: out });
        return out;
    });
}
