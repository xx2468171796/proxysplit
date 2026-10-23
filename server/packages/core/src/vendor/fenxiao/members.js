/**
 * 关系链:绑定上级、领邀请码、后台设等级 / 改挂上级。上级链(ancestors)是唯一事实源,
 * 改挂时连同整支下级一起重写,结算永远只读一行数组、不递归。
 */
import { chainUnder, findTier, MAX_CHAIN, MAX_LEVELS, BPS } from "./compute.js";
import { MEMBER_COLS, inTx, rows, toMember } from "./sql.js";
import { FenxiaoError, FxErrorCodes } from "./types.js";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-Z0-9]{4,16}$/;
export const normalizeCode = (code) => code.trim().toUpperCase();
function randomCode(len) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
async function memberOf(q, d, userId, lock = false) {
    const r = await rows(q, `SELECT ${MEMBER_COLS} FROM ${d.t.members} WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`, [userId]);
    return r[0] ? toMember(r[0]) : null;
}
export async function getMember(d, userId) {
    return memberOf(d.db, d, userId);
}
export async function findByCode(d, code, q = d.db) {
    const c = normalizeCode(code);
    if (!CODE_RE.test(c))
        return null;
    const r = await rows(q, `SELECT ${MEMBER_COLS} FROM ${d.t.members} WHERE code = $1`, [c]);
    return r[0] ? toMember(r[0]) : null;
}
async function ensureRow(q, d, userId) {
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
    if (!CODE_RE.test(normalizeCode(input.code)))
        return { bound: false, reason: "CODE_NOT_FOUND" };
    return inTx(d.db, input.tx, async (q) => {
        const inviter = await findByCode(d, input.code, q);
        if (!inviter)
            return { bound: false, reason: "CODE_NOT_FOUND" };
        if (!inviter.enabled)
            return { bound: false, reason: "INVITER_DISABLED" };
        if (inviter.userId === input.userId || inviter.ancestors.includes(input.userId))
            return { bound: false, reason: "SELF_REFERRAL" };
        await ensureRow(q, d, input.userId);
        const me = await memberOf(q, d, input.userId, true);
        if (me?.parentUserId)
            return { bound: false, reason: "ALREADY_BOUND" };
        const member = await attach(q, d, input.userId, inviter);
        d.emit({ type: "member.bound", member }, input.afterCommit);
        return { bound: true, member };
    });
}
async function assignCode(q, d, userId, wanted) {
    for (let i = 0; i < 8; i += 1) {
        const code = wanted ?? randomCode(8);
        const taken = await rows(q, `SELECT user_id FROM ${d.t.members} WHERE code = $1`, [code]);
        if (taken[0] && String(taken[0].user_id) !== userId) {
            if (wanted)
                throw new FenxiaoError(FxErrorCodes.CODE_TAKEN, "这个邀请码已被别人用了");
            continue;
        }
        await q.query(`UPDATE ${d.t.members} SET code = $2, updated_at = now() WHERE user_id = $1`, [userId, code]);
        return code;
    }
    throw new FenxiaoError(FxErrorCodes.CODE_TAKEN, "邀请码生成冲突,请重试");
}
/** 推广人领自己的邀请码:人人可推广时谁都能领;否则只有后台设了等级的人能领(NOT_ELIGIBLE) */
export async function ensureCode(d, userId, tx) {
    const policy = await d.policy(tx);
    return inTx(d.db, tx, async (q) => {
        await ensureRow(q, d, userId);
        const me = await memberOf(q, d, userId, true);
        if (!me)
            throw new FenxiaoError(FxErrorCodes.NOT_FOUND, "成员不存在");
        if (!me.enabled)
            throw new FenxiaoError(FxErrorCodes.NOT_ELIGIBLE, "推广资格已停用");
        if (!policy.openToAll && !findTier(policy, me.tierCode))
            throw new FenxiaoError(FxErrorCodes.NOT_ELIGIBLE, "还没有推广资格");
        if (!me.code)
            await assignCode(q, d, userId);
        return (await memberOf(q, d, userId)) ?? me;
    });
}
function assertOverride(r) {
    if (!r)
        return;
    if (r.length > MAX_LEVELS || r.some((v) => !Number.isInteger(v) || v < 0 || v > BPS)) {
        throw new FenxiaoError(FxErrorCodes.POLICY_INVALID, `逐级比例最多 ${MAX_LEVELS} 级,每级 0~${BPS}`);
    }
}
/** 后台设分销等级 / 停用 / 逐人比例 / 备注 / 自定义码。设了等级还没码的自动发一个 */
async function validateSetMember(d, input) {
    const policy = await d.policy(input.tx);
    if (input.tierCode && !findTier(policy, input.tierCode))
        throw new FenxiaoError(FxErrorCodes.TIER_NOT_FOUND, `没有等级 ${input.tierCode}`);
    assertOverride(input.rateOverride);
    const code = input.code === undefined ? undefined : normalizeCode(input.code);
    if (code !== undefined && !CODE_RE.test(code))
        throw new FenxiaoError(FxErrorCodes.CODE_INVALID, "邀请码只能是 4~16 位字母数字");
    return code;
}
const keep = (next, cur) => (next === undefined ? cur : next);
export async function setMember(d, input) {
    const code = await validateSetMember(d, input);
    return inTx(d.db, input.tx, async (q) => {
        await ensureRow(q, d, input.userId);
        const me = await memberOf(q, d, input.userId, true);
        if (!me)
            throw new FenxiaoError(FxErrorCodes.NOT_FOUND, "成员不存在");
        await q.query(`UPDATE ${d.t.members} SET tier_code = $2, enabled = $3, rate_override = $4::jsonb, note = $5, updated_at = now() WHERE user_id = $1`, [
            input.userId,
            keep(input.tierCode, me.tierCode),
            keep(input.enabled, me.enabled),
            JSON.stringify(keep(input.rateOverride, me.rateOverride)),
            keep(input.note, me.note)?.slice(0, 200) ?? null,
        ]);
        if (code !== undefined)
            await assignCode(q, d, input.userId, code);
        else if (!me.code && input.tierCode)
            await assignCode(q, d, input.userId);
        return (await memberOf(q, d, input.userId)) ?? me;
    });
}
/** 后台改挂上级(parentUserId=null 摘成顶层)。挂到自己的下级下面会成环,拒绝(CYCLE) */
export async function moveMember(d, input) {
    return inTx(d.db, input.tx, async (q) => {
        await ensureRow(q, d, input.userId);
        let parent = null;
        if (input.parentUserId) {
            await ensureRow(q, d, input.parentUserId);
            parent = await memberOf(q, d, input.parentUserId, true);
            if (!parent || parent.userId === input.userId || parent.ancestors.includes(input.userId)) {
                throw new FenxiaoError(FxErrorCodes.CYCLE, "不能挂到自己或自己的下级下面");
            }
        }
        await memberOf(q, d, input.userId, true);
        return attach(q, d, input.userId, parent);
    });
}
