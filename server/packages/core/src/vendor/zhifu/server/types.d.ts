import { z } from "zod";
import type { ChannelRule } from "../routing/index.ts";
/**
 * Standalone pay mode (owner 11-04, small projects): the same pipeline as the center, embedded in one app.
 * Admin knobs live in the app's own store; amounts are bigint cents; one order = one piece (no cross-site queue,
 * no split — those are center-only features).
 */
export type StandaloneOrderStatus = "pending" | "paid" | "expired" | "cancelled";
export interface StandaloneOrder {
    id: number;
    orderNo: string;
    /** The app's own idempotency key (unique). */
    merchantRef: string;
    playerKey: string;
    deviceKey: string | null;
    amountCents: bigint;
    status: StandaloneOrderStatus;
    returnUrl: string | null;
    clientIp: string | null;
    scanIp: string | null;
    createdAt: Date;
    expiresAt: Date;
    scanIssuedAt: Date | null;
    paidAt: Date | null;
    /** Set after `onPaid` succeeded (replays then never fulfil again). */
    fulfilledAt: Date | null;
    /** Fulfilment claim (one `onPaid` at a time; stale after 5 min). */
    fulfillingAt: Date | null;
    /** The app's business data (JSON), handed back on paid. */
    meta: Record<string, unknown> | null;
    test: boolean;
}
export type StandaloneAttemptStatus = "open" | "paid" | "failed" | "closed";
export interface StandaloneAttempt {
    id: number;
    attemptNo: string;
    orderId: number;
    channelCode: string;
    amountCents: bigint;
    status: StandaloneAttemptStatus;
    payUrl: string | null;
    expiresAt: Date;
    error: string | null;
}
export interface StandalonePayment {
    channelCode: string;
    attemptNo: string;
    upstreamTradeNo: string | null;
    orderId: number;
    amountCents: bigint;
    expectedCents: bigint;
    status: "settled" | "review" | "duplicate_piece";
    paidAt: Date;
}
/** One configured channel (credentials already decrypted by the store, see `zhifu/privacy` createSecretBox). */
export interface StandaloneChannel {
    code: string;
    kind: string;
    enabled: boolean;
    priority: number;
    weight: number;
    rule: ChannelRule;
    credentials: Record<string, unknown>;
}
/** Admin knobs (same meaning and defaults as the center's 开关总台 / 风控 / 通道异常 settings). */
export declare const standaloneKnobsSchema: z.ZodObject<{
    collection: z.ZodDefault<z.ZodBoolean>;
    collectionText: z.ZodDefault<z.ZodString>;
    minAmountCents: z.ZodDefault<z.ZodNumber>;
    maxAmountCents: z.ZodDefault<z.ZodNumber>;
    orderTtlSec: z.ZodDefault<z.ZodNumber>;
    scan: z.ZodDefault<z.ZodObject<{
        alipayOnly: z.ZodDefault<z.ZodBoolean>;
        allowPhoneBrowser: z.ZodDefault<z.ZodBoolean>;
        allowTablet: z.ZodDefault<z.ZodBoolean>;
        minScanDelayMs: z.ZodDefault<z.ZodNumber>;
        windowMin: z.ZodDefault<z.ZodNumber>;
        maxPerIp: z.ZodDefault<z.ZodNumber>;
        maxPerDevice: z.ZodDefault<z.ZodNumber>;
        maxPerPlayer: z.ZodDefault<z.ZodNumber>;
        ipGate: z.ZodDefault<z.ZodBoolean>;
        blockOverseas: z.ZodDefault<z.ZodBoolean>;
        blockHkMoTw: z.ZodDefault<z.ZodBoolean>;
        blockUnknownGeo: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    outageGate: z.ZodDefault<z.ZodBoolean>;
    outageTitle: z.ZodDefault<z.ZodString>;
    outageBody: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type StandaloneKnobs = z.infer<typeof standaloneKnobsSchema>;
export declare const DEFAULT_STANDALONE_KNOBS: StandaloneKnobs;
export interface NewOrder {
    orderNo: string;
    merchantRef: string;
    playerKey: string;
    deviceKey: string | null;
    amountCents: bigint;
    returnUrl: string | null;
    clientIp: string | null;
    createdAt: Date;
    expiresAt: Date;
    meta: Record<string, unknown> | null;
    test: boolean;
}
/** Everything the standalone pipeline needs to persist. Implementations: memory (tests / demo) and node-pg. */
export interface StandaloneStore {
    insertOrder(o: NewOrder): Promise<{
        order: StandaloneOrder;
        created: boolean;
    }>;
    orderByNo(orderNo: string): Promise<StandaloneOrder | null>;
    markScanned(orderId: number, ip: string | null, at: Date): Promise<void>;
    /** Claim fulfilment: true for exactly one caller until `markFulfilled` or the claim goes stale (5 min). */
    claimFulfilment(orderId: number, at: Date): Promise<boolean>;
    markFulfilled(orderId: number, at: Date): Promise<void>;
    /** `onPaid` failed: drop the claim so the upstream retry can fulfil at once. */
    releaseFulfilment(orderId: number): Promise<void>;
    /** Player cancel: pending → cancelled (open attempts closed; late money still settles). false = not pending. */
    cancelOrder(orderId: number, at: Date): Promise<boolean>;
    /** Sweeper: pending orders past expiry → expired (+ their open attempts closed); returns how many. */
    expireDue(now: Date, limit: number): Promise<number>;
    /** Retention (owner 11-03: logs 35 days): events and failed / closed attempts older than `before`. Money rows stay. */
    pruneLogs(before: Date, limit: number): Promise<number>;
    /** Serialise work on one order across requests / instances (opening upstream attempts). */
    withOrderLock<T>(orderId: number, fn: () => Promise<T>): Promise<T>;
    /** Latest open attempt with a pay URL that has not expired. */
    liveAttempt(orderId: number, now: Date): Promise<StandaloneAttempt | null>;
    /** Insert an open attempt (attempt no unique). */
    reserveAttempt(a: Omit<StandaloneAttempt, "id" | "status" | "payUrl" | "error">): Promise<StandaloneAttempt>;
    finishAttempt(id: number, r: {
        payUrl: string;
        expiresAt: Date;
    } | {
        error: string;
    }): Promise<StandaloneAttempt | null>;
    channels(): Promise<StandaloneChannel[]>;
    saveChannel(c: StandaloneChannel): Promise<void>;
    recordCreate(code: string, ok: boolean, error: string | null, at: Date): Promise<void>;
    /** Channel revenue facts for the routing caps. */
    channelFacts(code: string, now: Date): Promise<import("../routing/index.ts").ChannelFacts>;
    knobs(): Promise<StandaloneKnobs>;
    saveKnobs(k: StandaloneKnobs, actor: string, reason: string): Promise<void>;
    /** Runs `fn` in ONE transaction with row locks (settle). */
    inSettleTx<T>(fn: (tx: StandaloneSettleTx) => Promise<T>): Promise<T>;
}
/** Transaction-bound operations behind `settleWith`. */
export interface StandaloneSettleTx {
    lockAttempt(attemptNo: string): Promise<StandaloneAttempt | null>;
    lockOrder(orderId: number): Promise<StandaloneOrder | null>;
    /** false = the fact existed (unique channel+attempt / channel+trade). */
    insertPayment(p: StandalonePayment): Promise<boolean>;
    paymentByTrade(channelCode: string, tradeNo: string): Promise<{
        attemptNo: string;
    } | null>;
    closeAttempt(id: number): Promise<void>;
    creditChannel(code: string, paidAt: Date, cents: bigint): Promise<void>;
    markOrderPaid(orderId: number, paidAt: Date): Promise<void>;
    openIssue(kind: string, refKey: string, detail: Record<string, string>): Promise<void>;
}