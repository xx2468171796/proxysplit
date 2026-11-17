/** Money arriving for a piece: always accepted unless the piece is already paid (then it is a duplicate). */
export function pieceAcceptsPayment(status) {
    if (status === "paid")
        return "duplicate";
    return status === "pending" ? "accept" : "late";
}
/** Order status derived from its pieces (paid wins over expired/cancelled: money that arrived is real). */
export function deriveOrderStatus(pieces, current) {
    const paid = pieces.filter((p) => p.status === "paid").length;
    if (pieces.length > 0 && paid === pieces.length)
        return "paid";
    if (paid > 0)
        return "partial";
    return current;
}
export function paidCentsOf(pieces) {
    return pieces.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amountCents, 0n);
}
export function canCancel(status) {
    return status === "pending";
}
export function canResume(status) {
    return status === "pending" || status === "partial";
}
export function canRefund(status, paidCents, refundedCents, amount) {
    return (status === "paid" || status === "partial") && amount > 0n && refundedCents + amount <= paidCents;
}
