import { pieceAcceptsPayment } from "./order-state.js";
/** Classification of an arrived payment against the locked attempt / piece. Pure. */
export function factStatusOf(amountCents, attemptCents, piece) {
    if (amountCents !== attemptCents)
        return "review";
    return pieceAcceptsPayment(piece) === "duplicate" ? "duplicate_piece" : "settled";
}
/** Run inside one transaction (see the module doc). */
export async function settleWith(port, input) {
    const t = await port.lockTargets(input);
    if (!t)
        return { outcome: "unknown_attempt", orderNo: null, orderStatus: null };
    const accept = pieceAcceptsPayment(t.piece.status);
    const status = factStatusOf(input.amountCents, t.attempt.amountCents, t.piece.status);
    if (!(await port.insertFact(input, t, status))) {
        await port.checkConflict(input, t.order);
        return { outcome: "already", orderNo: t.order.orderNo, orderStatus: t.order.status };
    }
    await port.closeAttempt(t.attempt);
    // Channel test orders never count toward the channel's revenue / daily caps.
    if (!t.order.test)
        await port.creditChannel(input.channelCode, input.paidAt, input.amountCents);
    if (status !== "settled") {
        await port.openAnomaly(input, t, status);
        return { outcome: status, orderNo: t.order.orderNo, orderStatus: t.order.status };
    }
    const orderStatus = await port.markPiecePaid(t.order, t.piece, accept === "late", input.paidAt);
    return { outcome: "settled", orderNo: t.order.orderNo, orderStatus };
}
