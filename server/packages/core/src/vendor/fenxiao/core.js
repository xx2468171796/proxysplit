/**
 * 各模块共用的底座:依赖包、事务里跑并在提交后发事件、账户加减、审计落库。
 */
import { inTx } from "./sql.js";
/**
 * 在事务里跑 fn,fn 往 events 里放事件:
 * - 宿主传了 tx + afterCommit → 宿主提交后发;
 * - 宿主传了 tx 没给 afterCommit → fn 跑完立刻发(宿主事务可能还会回滚,接入手册里写明);
 * - 包自己开的事务 → 提交后发。
 */
export async function run(d, io, fn) {
    const events = [];
    const out = await inTx(d.db, io.tx, (q) => fn(q, events));
    if (events.length === 0)
        return out;
    if (io.tx && io.afterCommit)
        io.afterCommit(() => d.dispatch(events));
    else
        await d.dispatch(events);
    return out;
}
/** 账户加减:一行 upsert,行锁顺带拿到。多人时调用方按 user id 升序调(全包同序,不互相死锁) */
export async function bump(q, t, userId, deltas) {
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
/** 后台操作留痕(和业务同事务写,回滚一起回滚) */
export async function audit(q, d, e) {
    const detail = JSON.stringify(e.detail, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    await q.query(`INSERT INTO ${d.t.audit} (actor_id, action, target_user_id, detail, created_at) VALUES ($1, $2, $3, $4::jsonb, $5)`, [
        e.actorId,
        e.action,
        e.targetUserId,
        detail,
        d.now(),
    ]);
}
/** 加锁顺序用的比较:按码点比,不受系统区域 / ICU 影响(多实例必须同序,否则互相死锁) */
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
