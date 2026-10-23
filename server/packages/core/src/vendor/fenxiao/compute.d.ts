/**
 * 多级佣金的纯计算:没有 IO,单测直接打表。
 *
 * level(逐级比例):第 k 级上级拿 floor(基数 × 他自己的 rates[k-1] / 10000)。
 * differential(级差):从直接上级往上走,每人的总比例 T = rates[0];他拿 T − 下面已分走的最高比例(不够就 0),
 *   于是「经销商 15% 下面挂分销商 10%」时分销商拿 10%,经销商拿 5%,合计正好是最高那档的 15%。
 * 两种算法最后都过一道 totalCapBps:按就近优先分配,合计比例超出部分从远端砍掉。
 */
import { type FxChainLink, type FxPolicy, type FxShare, type FxTier } from "./types.ts";
export declare const BPS = 10000;
/** 上级链最长存多少级(maxLevels 上限 10,多存几级给后台看团队) */
export declare const MAX_CHAIN = 20;
export declare const MAX_LEVELS = 10;
export declare const DEFAULT_FX_POLICY: FxPolicy;
/** 规则合法性:宿主把配置转成 FxPolicy 后先过一遍(后台保存时也调),坏规则别发到一半 */
export declare function assertFxPolicy(p: FxPolicy): void;
export declare function findTier(policy: FxPolicy, code: string | null): FxTier | null;
/**
 * 某位上级能拿的逐级比例:停用 → null;逐人覆盖 > 等级 > (人人可推广时)默认;都没有 → null。
 * 等级 code 在规则里找不到(后台删了档)按普通用户处理,不会因为删档把人卡死。
 */
export declare function ratesFor(policy: FxPolicy, m: {
    enabled: boolean;
    tierCode: string | null;
    rateOverride: number[] | null;
}): number[] | null;
/** 一笔付款给上级链分佣:chain 就近在前(chain[0] = 直接上级)。只返回金额 > 0 的份额 */
export declare function computeShares(chain: readonly FxChainLink[], baseAmount: bigint, policy: FxPolicy): FxShare[];
/** 新成员的上级链:[上级, ...上级的上级链],截到 MAX_CHAIN */
export declare function chainUnder(parentUserId: string, parentAncestors: readonly string[]): string[];