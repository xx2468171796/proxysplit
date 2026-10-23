/**
 * 多级佣金的纯计算:没有 IO,单测直接打表。
 *
 * level(逐级比例):第 k 级上级拿 floor(基数 × 他自己的 rates[k-1] / 10000)。
 * differential(级差):从直接上级往上走,每人的总比例 T = rates[0];他拿 T − 下面已分走的最高比例(不够就 0),
 *   于是「经销商 15% 下面挂分销商 10%」时分销商拿 10%,经销商拿 5%,合计正好是最高那档的 15%。
 * 两种算法最后都过一道 totalCapBps:按就近优先分配,合计比例超出部分从远端砍掉。
 */
import { FenxiaoError, FxErrorCodes } from "./types.js";
export const BPS = 10_000;
/** 上级链最长存多少级(maxLevels 上限 10,多存几级给后台看团队) */
export const MAX_CHAIN = 20;
export const MAX_LEVELS = 10;
export const DEFAULT_FX_POLICY = {
    enabled: false,
    mode: "level",
    maxLevels: 2,
    openToAll: false,
    defaultRates: [],
    tiers: [],
    totalCapBps: BPS,
    freezeDays: 7,
    minBaseAmount: 0n,
    minWithdrawal: 100n,
};
const TIER_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
function fail(message) {
    throw new FenxiaoError(FxErrorCodes.POLICY_INVALID, message);
}
function assertBps(v, field) {
    if (!Number.isInteger(v) || v < 0 || v > BPS)
        fail(`${field} 必须是 0~${BPS} 的整数(万分比)`);
}
function assertRates(rates, field) {
    if (!Array.isArray(rates) || rates.length > MAX_LEVELS)
        fail(`${field} 最多 ${MAX_LEVELS} 级`);
    for (const [i, r] of rates.entries())
        assertBps(r, `${field}[${i}]`);
}
/** 规则合法性:宿主把配置转成 FxPolicy 后先过一遍(后台保存时也调),坏规则别发到一半 */
export function assertFxPolicy(p) {
    if (p.mode !== "level" && p.mode !== "differential")
        fail("mode 只能是 level / differential");
    if (!Number.isInteger(p.maxLevels) || p.maxLevels < 1 || p.maxLevels > MAX_LEVELS)
        fail(`maxLevels 必须是 1~${MAX_LEVELS}`);
    assertRates(p.defaultRates, "defaultRates");
    const seen = new Set();
    for (const t of p.tiers) {
        if (!TIER_CODE_RE.test(t.code))
            fail(`等级代码 ${t.code} 只能是小写字母数字与 - _`);
        if (seen.has(t.code))
            fail(`等级代码 ${t.code} 重复`);
        seen.add(t.code);
        if (!t.name.trim())
            fail(`等级 ${t.code} 缺名称`);
        assertRates(t.rates, `tiers.${t.code}.rates`);
    }
    assertBps(p.totalCapBps, "totalCapBps");
    if (!Number.isInteger(p.freezeDays) || p.freezeDays < 0 || p.freezeDays > 365)
        fail("freezeDays 必须是 0~365");
    if (p.minBaseAmount < 0n)
        fail("minBaseAmount 不能为负");
    if (p.minWithdrawal < 1n)
        fail("minWithdrawal 至少为 1");
}
export function findTier(policy, code) {
    return code === null ? null : (policy.tiers.find((t) => t.code === code) ?? null);
}
/**
 * 某位上级能拿的逐级比例:停用 → null;逐人覆盖 > 等级 > (人人可推广时)默认;都没有 → null。
 * 等级 code 在规则里找不到(后台删了档)按普通用户处理,不会因为删档把人卡死。
 */
export function ratesFor(policy, m) {
    if (!m.enabled)
        return null;
    if (m.rateOverride)
        return m.rateOverride;
    const tier = findTier(policy, m.tierCode);
    if (tier)
        return tier.rates;
    return policy.openToAll ? policy.defaultRates : null;
}
function rawShares(chain, policy) {
    const links = chain.slice(0, policy.maxLevels);
    if (policy.mode === "level") {
        return links.map((l, i) => ({ userId: l.userId, level: i + 1, rateBps: l.rates?.[i] ?? 0 }));
    }
    let assigned = 0;
    return links.map((l, i) => {
        const total = l.rates?.[0] ?? 0;
        const rateBps = Math.max(0, total - assigned);
        assigned = Math.max(assigned, total);
        return { userId: l.userId, level: i + 1, rateBps };
    });
}
/** 一笔付款给上级链分佣:chain 就近在前(chain[0] = 直接上级)。只返回金额 > 0 的份额 */
export function computeShares(chain, baseAmount, policy) {
    if (baseAmount <= 0n)
        return [];
    let room = policy.totalCapBps;
    const out = [];
    for (const s of rawShares(chain, policy)) {
        const rateBps = Math.min(s.rateBps, room);
        room -= rateBps;
        const amount = (baseAmount * BigInt(rateBps)) / BigInt(BPS);
        if (amount > 0n)
            out.push({ userId: s.userId, level: s.level, rateBps, amount });
    }
    return out;
}
/** 新成员的上级链:[上级, ...上级的上级链],截到 MAX_CHAIN */
export function chainUnder(parentUserId, parentAncestors) {
    return [parentUserId, ...parentAncestors].slice(0, MAX_CHAIN);
}
