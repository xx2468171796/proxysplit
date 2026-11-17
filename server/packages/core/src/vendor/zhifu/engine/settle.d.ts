import { type PieceStatus } from "./order-state.ts";
/**
 * Settlement orchestration (both pay modes): the ONLY path that turns "money arrived" into "paid". The host runs
 * `settleWith` inside ONE database transaction and gives it a port bound to that transaction; the unique
 * (channel, attempt) / (channel, trade) indexes behind `insertFact` make it exactly-once. Decision order:
 * lock attempt → order → piece; classify (amount differs → review, piece already paid → duplicate_piece);
 * fact first (a repeat stops here as "already"); close the attempt; credit the channel (not for test orders);
 * anomalies stop before "paid"; otherwise mark the piece / order paid (the host enqueues the site notify there).
 */
export type SettleSource = "callback" | "reconcile" | "complaint" | "manual";
export interface SettleInput {
    channelCode: string;
    attemptNo: string;
    amountCents: bigint;
    upstreamTradeNo: string | null;
    payerInfo: string | null;
    paidAt: Date;
    raw: Record<string, unknown> | null;
    source: SettleSource;
    /** Staff who triggered it (complaint / manual); absent = "settle:<source>". */
    actor?: {
        id: string;
        name: string;
    } | undefined;
    reason?: string | null | undefined;
}
export type SettleOutcome = "settled" | "already" | "review" | "duplicate_piece" | "unknown_attempt";
export interface SettleResult {
    outcome: SettleOutcome;
    orderNo: string | null;
    orderStatus: string | null;
}
export type FactStatus = "settled" | "review" | "duplicate_piece";
/** What settlement needs to see of the locked rows; hosts pass their full rows (extra fields are kept). */
export interface SettleTargets<A extends SettleAttempt, O extends SettleOrder, P extends SettlePiece> {
    attempt: A;
    order: O;
    piece: P;
}
export interface SettleAttempt {
    id: number | string;
    amountCents: bigint;
}
export interface SettleOrder {
    orderNo: string;
    status: string;
    test: boolean;
}
export interface SettlePiece {
    status: PieceStatus;
    amountCents: bigint;
}
/** Transaction-bound port; every call runs in the host's single settle transaction. */
export interface SettlePort<A extends SettleAttempt, O extends SettleOrder, P extends SettlePiece> {
    /** Lock attempt → order → piece (this fixed order everywhere); null = unknown attempt or other channel. */
    lockTargets(input: SettleInput): Promise<SettleTargets<A, O, P> | null>;
    /** Append-only payment fact; false = it already existed (unique index). */
    insertFact(input: SettleInput, t: SettleTargets<A, O, P>, status: FactStatus): Promise<boolean>;
    /** Fact existed: if the trade no sits on ANOTHER attempt, open an issue for staff (never a silent repeat). */
    checkConflict(input: SettleInput, order: O): Promise<void>;
    closeAttempt(attempt: A): Promise<void>;
    /** Channel revenue / daily caps. */
    creditChannel(channelCode: string, paidAt: Date, amountCents: bigint): Promise<void>;
    openAnomaly(input: SettleInput, t: SettleTargets<A, O, P>, status: FactStatus): Promise<void>;
    /** Piece paid → order status re-derived → paid notify enqueued; returns the new order status. */
    markPiecePaid(order: O, piece: P, late: boolean, paidAt: Date): Promise<string>;
}
/** Classification of an arrived payment against the locked attempt / piece. Pure. */
export declare function factStatusOf(amountCents: bigint, attemptCents: bigint, piece: PieceStatus): FactStatus;
/** Run inside one transaction (see the module doc). */
export declare function settleWith<A extends SettleAttempt, O extends SettleOrder, P extends SettlePiece>(port: SettlePort<A, O, P>, input: SettleInput): Promise<SettleResult>;