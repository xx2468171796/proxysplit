/**
 * Split payments (same rules as zhifu `split/plan.ts`, bigint cents), integer cents only.
 * Owner 11-01: default config does NOT split — ¥200 is one ¥200.00 payment unless the site enables splitting.
 */
export interface SplitConfig {
    enabled: boolean;
    mode: "greedy" | "even";
    perPieceMaxCents: number;
    maxPieces: number;
}
export type SplitPlan = {
    kind: "single";
} | {
    kind: "split";
    piecesCents: bigint[];
} | {
    kind: "tooLarge";
};
export declare function planSplit(totalCents: bigint, config: SplitConfig): SplitPlan;
export declare function piecesOf(totalCents: bigint, config: SplitConfig): bigint[] | null;