import type { FxChainLink, FxPolicy, FxShare } from "./types.ts";
/**
 * 一笔付款给上级链分佣:chain 就近在前(chain[0] = 直接上级)。只返回金额 > 0 的份额。
 * multiplierBps = 商品倍率(10000 = 不变)。
 */
export declare function computeShares(chain: readonly FxChainLink[], baseAmount: bigint, policy: FxPolicy, multiplierBps?: number): FxShare[];
/** 新成员的上级链:[上级, ...上级的上级链],截到 MAX_CHAIN */
export declare function chainUnder(parentUserId: string, parentAncestors: readonly string[]): string[];