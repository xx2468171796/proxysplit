/**
 * 关系链:绑定上级、领邀请码、后台设等级 / 改挂上级。上级链(ancestors)是唯一事实源,
 * 改挂时连同整支下级一起重写,结算永远只读一行数组、不递归。
 */
import { chainUnder } from "./compute.js";
import { audit, run } from "./core.js";
import { assertRates, canPromote, findTier, MAX_CHAIN } from "./policy.js";
import { MEMBER_COLS, rows, toMember } from "./sql.js";
import { FenxiaoError, FxErrorCodes } from "./types.js";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-Z0-9]{4,16}$/;
export const normalizeCode = (code) => code.trim().toUpperCase();
export const isValidCode = (code) => CODE_RE.test(normalizeCode(code));
function randomCode(len) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
export async function memberOf(q, d, userId, lock = false) {
    const r = await rows(q, `SELECT ${MEMBER_COLS} FROM ${d.t.members} WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`, [userId]);
    return r[0] ? toMember(r[0]) : null;
}
export async function findByCode(d, code, q = d.db, lock = false) {
    const c = normalizeCode(code);
    if (!CODE_RE.test(c))
        return null;
    const r = await rows(q, `SELECT ${MEMBER_COLS} FROM ${d.t.members} WHERE code = $1${lock ? " FOR SHARE" : ""}`, [c]);
    return r[0] ? toMember(r[0]) : null;
}
export async function ensureRow(q, d, userId) {
    await q.query(`INSERT INTO ${d.t.members} (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
}
/** 把 userId 挂到 parent 下(parent=null 摘成顶层),并重写整支下级的上级链 */
async function attach(q, d, userId, parent) {
    const chain = parent ? chainUnder(parent.userId, parent.ancestors) : [];
    const r = await rows(q, `UPDATE ${d.t.members} SET parent_user_id = $2, ancestors = $3::text[], bound_at = $4, updated_at = now()
     WHERE user_id = $1 RETURNING ${MEMBER_COLS}`, [userId, parent?.userId ?? null, chain, parent ? d.now() : null]);
    await q.query(`UPDATE ${d.t.members} SET ancestors = (ancestors[1:array_position(ancestors, $1)] || $2::text[])[1:${MAX_CHAIN}], updated_at = now()
     WHERE ancestors @> ARRAY[$1]::text[]`, [userId, chain]);
    return toMember(r[0] ?? {});
}
/**
 * 注册那一刻:带码绑上级(在宿主建号事务里调并传 tx)。不抛错:坏码只是不绑定。
 * 已经有上级的人返回 ALREADY_BOUND(一生一次;要改走后台 moveMember)。
 */
export async function bind(d, input) {
    if (!isValidCode(input.code))
        return { bound: false, reason: "CODE_NOT_FOUND" };
    return run(d, input, async (q, events) => {
        // FOR SHARE:并发改挂邀请人时,等它改完再读上级链,新人不会拿到过时的链
        const inviter = await findByCode(d, input.code, q, true);
        if (!inviter)
            return { bound: false, reason: "CODE_NOT_FOUND" };
        if (!inviter.enabled)
            return { bound: false, reason: "INVITER_DISABLED" };
        if (inviter.userId === input.userId || inviter.ancestors.includes(input.userId))
            return { bound: false, reason: "SELF_REFERRAL" };
        // 上级链只存 MAX_CHAIN 级:存满了就沿 parent 递归查一遍,防止老用户绑到自己 20 级以下的下级成环
        if (inviter.ancestors.length >= MAX_CHAIN) {
            await lockTree(q, d);
            if (await isAncestor(q, d, input.userId, inviter.userId))
                return { bound: false, reason: "SELF_REFERRAL" };
        }
        await ensureRow(q, d, input.userId);
        const me = await memberOf(q, d, input.userId, true);
        if (me?.parentUserId)
            return { bound: false, reason: "ALREADY_BOUND" };
        const member = await attach(q, d, input.userId, inviter);
        events.push({ type: "member.bound", member });
        return { bound: true, member };
    });
}
/** 写码;被别人占了(先查到或同一时刻撞唯一约束)返回 false */
async function tryWriteCode(q, d, userId, code) {
    const taken = await rows(q, `SELECT user_id FROM ${d.t.members} WHERE code = $1`, [code]);
    if (taken[0] && String(taken[0].user_id) !== userId)
        return false;
    await q.query("SAVEPOINT fx_code");
    try {
        await q.query(`UPDATE ${d.t.members} SET code = $2, updated_at = now() WHERE user_id = $1`, [userId, code]);
        await q.query("RELEASE SAVEPOINT fx_code");
        return true;
    }
    catch (e) {
        await q.query("ROLLBACK TO SAVEPOINT fx_code");
        if (e.code !== "23505")
            throw e;
        return false;
    }
}
export async function assignCode(q, d, userId, wanted) {
    for (let i = 0; i < 8; i += 1) {
        const code = wanted ?? randomCode(8);
        if (await tryWriteCode(q, d, userId, code))
            return code;
        // 自定义码被占直接报;随机码换一个再试
        if (wanted)
            throw new FenxiaoError(FxErrorCodes.CODE_TAKEN, "这个邀请码已被别人用了");
    }
    throw new FenxiaoError(FxErrorCodes.CODE_TAKEN, "邀请码生成冲突,请重试");
}
/** 推广人领自己的邀请码:人人可推广时谁都能领;否则只有设了等级的人能领(NOT_ELIGIBLE) */
export async function ensureCode(d, userId, tx) {
    const policy = await d.policy(tx);
    return run(d, tx ? { tx } : {}, async (q) => {
        await ensureRow(q, d, userId);
        const me = await memberOf(q, d, userId, true);
        if (!me)
            throw new FenxiaoError(FxErrorCodes.NOT_FOUND, "成员不存在");
        if (!me.enabled)
            throw new FenxiaoError(FxErrorCodes.NOT_ELIGIBLE, "推广资格已停用");
        if (!canPromote(policy, me))
            throw new FenxiaoError(FxErrorCodes.NOT_ELIGIBLE, "还没有推广资格");
        if (!me.code)
            await assignCode(q, d, userId);
        return (await memberOf(q, d, userId)) ?? me;
    });
}
async function validateSetMember(d, input) {
    const policy = await d.policy(input.tx);
    if (input.tierCode && !findTier(policy, input.tierCode))
        throw new FenxiaoError(FxErrorCodes.TIER_NOT_FOUND, `没有等级 ${input.tierCode}`);
    if (input.rateOverride) {
        try {
            assertRates(input.rateOverride, "rateOverride");
        }
        catch (e) {
            throw new FenxiaoError(FxErrorCodes.INPUT_INVALID, e.message);
        }
    }
    const code = input.code === undefined ? undefined : normalizeCode(input.code);
    if (code !== undefined && !CODE_RE.test(code))
        throw new FenxiaoError(FxErrorCodes.CODE_INVALID, "邀请码只能是 4~16 位字母数字");
    return code;
}
const keep = (next, cur) => (next === undefined ? cur : next);
/** 后台设分销等级 / 停用 / 逐人比例 / 备注 / 自定义码。设了等级还没码的自动发一个 */
export async function setMember(d, input) {
    const code = await validateSetMember(d, input);
    return run(d, input, async (q, events) => {
        await ensureRow(q, d, input.userId);
        const me = await memberOf(q, d, input.userId, true);
        if (!me)
            throw new FenxiaoError(FxErrorCodes.NOT_FOUND, "成员不存在");
        const next = {
            tierCode: keep(input.tierCode, me.tierCode),
            enabled: keep(input.enabled, me.enabled),
            rateOverride: keep(input.rateOverride, me.rateOverride),
            note: keep(input.note, me.note)?.slice(0, 200) ?? null,
        };
        await q.query(`UPDATE ${d.t.members} SET tier_code = $2, enabled = $3, rate_override = $4::jsonb, note = $5, updated_at = now() WHERE user_id = $1`, [
            input.userId,
            next.tierCode,
            next.enabled,
            JSON.stringify(next.rateOverride),
            next.note,
        ]);
        if (code !== undefined && code !== me.code)
            await assignCode(q, d, input.userId, code);
        else if (!me.code && input.tierCode)
            await assignCode(q, d, input.userId);
        const member = (await memberOf(q, d, input.userId)) ?? me;
        await audit(q, d, { actorId: input.operatorId, action: "member.set", targetUserId: input.userId, detail: { before: pick(me), after: pick(member) } });
        events.push({ type: "member.updated", member, action: "set", operatorId: input.operatorId });
        return member;
    });
}
const pick = (m) => ({ tierCode: m.tierCode, enabled: m.enabled, rateOverride: m.rateOverride, code: m.code, note: m.note });
/** 改树结构的事务级锁(随提交 / 回滚释放) */
async function lockTree(q, d) {
    await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`fenxiao:${d.t.members}:tree`]);
}
/** userId 是否在 of 的上级链上(沿 parent_user_id 走,不受 ancestors 只存 MAX_CHAIN 级的限制) */
async function isAncestor(q, d, userId, of) {
    const r = await rows(q, `WITH RECURSIVE up(id, n) AS (
       SELECT parent_user_id, 1 FROM ${d.t.members} WHERE user_id = $2
       UNION ALL SELECT m.parent_user_id, up.n + 1 FROM ${d.t.members} m JOIN up ON m.user_id = up.id WHERE up.n < 10000)
     SELECT 1 FROM up WHERE id = $1 LIMIT 1`, [userId, of]);
    return r.length > 0;
}
/** 后台改挂上级(parentUserId=null 摘成顶层)。挂到自己的下级下面会成环,拒绝(CYCLE) */
export async function moveMember(d, input) {
    return run(d, input, async (q, events) => {
        // 两个改挂各锁各的行,各自查环都通过,合起来却成环:整棵树的改挂排队做
        await lockTree(q, d);
        await ensureRow(q, d, input.userId);
        let parent = null;
        if (input.parentUserId) {
            await ensureRow(q, d, input.parentUserId);
            parent = await memberOf(q, d, input.parentUserId, true);
            if (!parent || parent.userId === input.userId || parent.ancestors.includes(input.userId) || (await isAncestor(q, d, input.userId, parent.userId))) {
                throw new FenxiaoError(FxErrorCodes.CYCLE, "不能挂到自己或自己的下级下面");
            }
        }
        const before = await memberOf(q, d, input.userId, true);
        const member = await attach(q, d, input.userId, parent);
        await audit(q, d, {
            actorId: input.operatorId,
            action: "member.move",
            targetUserId: input.userId,
            detail: { from: before?.parentUserId ?? null, to: parent?.userId ?? null },
        });
        events.push({ type: "member.updated", member, action: "move", operatorId: input.operatorId });
        return member;
    });
}
