/** Order / piece state rules. Pure: the services persist what these decide. */
export type OrderStatus = "pending" | "partial" | "paid" | "expired" | "cancelled";
export type PieceStatus = "pending" | "paid" | "expired" | "cancelled";
export interface PieceState {
    status: PieceStatus;
    amountCents: bigint;
}
/** Money arriving for a piece: always accepted unless the piece is already paid (then it is a duplicate). */
export declare function pieceAcceptsPayment(status: PieceStatus): "accept" | "late" | "duplicate";
/** Order status derived from its pieces (paid wins over expired/cancelled: money that arrived is real). */
export declare function deriveOrderStatus(pieces: readonly PieceState[], current: OrderStatus): OrderStatus;
export declare function paidCentsOf(pieces: readonly PieceState[]): bigint;
export declare function canCancel(status: OrderStatus): boolean;
export declare function canResume(status: OrderStatus): boolean;
export declare function canRefund(status: OrderStatus, paidCents: bigint, refundedCents: bigint, amount: bigint): boolean;