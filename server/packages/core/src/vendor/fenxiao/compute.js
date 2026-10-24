/**
 * 多级佣金的纯计算:没有 IO,单测直接打表。
 *
 * level(逐级比例):第 k 级上级拿 floor(基数 × 他自己的 rates[k-1] / 10000)。
 * differential(级差):从直接上级往上走,每人的总比例 T = rates[0];他拿 T − 下面已分走的最高比例(不够就 0),
 *   于是「经销商 15% 下面挂分销商 10%」时分销商拿 10%,经销商拿 5%,合计正好是最高那档的 15%。
 * 两种算法再乘商品倍率,最后过一道 totalCapBps:按就近优先分配,合计比例超出部分从远端砍掉。
 */
import { BPS, MAX_CHAIN } from "./policy.js";
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
/**
 * 一笔付款给上级链分佣:chain 就近在前(chain[0] = 直接上级)。只返回金额 > 0 的份额。
 * multiplierBps = 商品倍率(10000 = 不变)。
 */
export function computeShares(chain, baseAmount, policy, multiplierBps = BPS) {
    if (baseAmount <= 0n)
        return [];
    let room = policy.totalCapBps;
    const out = [];
    for (const s of rawShares(chain, policy)) {
        const scaled = Math.floor((s.rateBps * multiplierBps) / BPS);
        const rateBps = Math.min(scaled, room);
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
