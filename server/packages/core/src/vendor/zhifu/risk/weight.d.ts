import { type OpenOrderRules } from "../order/open-rules.ts";
/**
 * 未付加权（纯函数）：快速取消按 quickCancelWeight 计；扫码才建单的单子从没被扫过又没付，按 unscannedWeight 计
 * （业主 11-01：没扫的未付算 1.5 笔）。
 */
export interface WeightedScanOrder {
    status: string;
    createdAt: Date;
    cancelledAt?: Date | null;
    /** 扫码才建单的单子（scannedAt 为 null = 二维码从没被扫）。缺省 = 不是扫码单。 */
    scanToCreate?: boolean;
    scannedAt?: Date | null;
}
export type CancelWeighting = Pick<OpenOrderRules, "quickCancelSec" | "quickCancelWeight"> & {
    unscannedWeight?: number;
};
export declare function orderWeight(o: WeightedScanOrder, w: CancelWeighting): number;
/** 倒序累加，遇到已付停，向下取整。 */
export declare function scanWeightedStreak(recent: readonly WeightedScanOrder[], w: CancelWeighting): number;