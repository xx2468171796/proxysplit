function evenPieces(total, max) {
    const n = (total + max - 1n) / max;
    const base = total / n;
    const extra = total - base * n;
    return Array.from({ length: Number(n) }, (_, i) => (BigInt(i) < extra ? base + 1n : base));
}
function greedyPieces(total, max) {
    const n = total / max;
    const rest = total - n * max;
    const full = Array.from({ length: Number(n) }, () => max);
    return rest > 0n ? [...full, rest] : full;
}
export function planSplit(totalCents, config) {
    const max = BigInt(config.perPieceMaxCents);
    if (!config.enabled || totalCents <= max)
        return { kind: "single" };
    const piecesCents = config.mode === "even" ? evenPieces(totalCents, max) : greedyPieces(totalCents, max);
    if (piecesCents.length > config.maxPieces)
        return { kind: "tooLarge" };
    if (piecesCents.length <= 1)
        return { kind: "single" };
    return { kind: "split", piecesCents };
}
export function piecesOf(totalCents, config) {
    const plan = planSplit(totalCents, config);
    if (plan.kind === "tooLarge")
        return null;
    return plan.kind === "single" ? [totalCents] : plan.piecesCents;
}
