import type { ChannelAdapter, CreateInput, QueryResult } from "../types.ts";
/**
 * Mock channel for tests and local dev. State lives in the controller, so tests can
 * flip an attempt to paid and produce signed callbacks the same way a real upstream would.
 */
export interface MockState {
    /** What the service handed upstream (hand-off contract tests read it). */
    input?: CreateInput;
    amountCents: bigint;
    status: QueryResult["status"];
    tradeNo: string;
    paidAt?: Date;
}
export declare class MockUpstream {
    readonly secret: string;
    readonly orders: Map<string, MockState>;
    failNextCreates: number;
    /** Error text of the scripted failures (e.g. a timeout, to drive the health "timeouts" signal). */
    failMessage: string;
    /** Next creates THROW instead of returning ok:false (adapter bugs / crashes). */
    throwNextCreates: number;
    queryUnavailable: boolean;
    /** Scripted refund outcomes (FIFO); empty = succeeded. */
    refundResults: ("succeeded" | "failed" | "pending")[];
    /** Scripted refund-query outcomes by refund_no; missing = null (unknown). */
    refundQueryResults: Map<string, "pending" | "failed" | "succeeded">;
    /** Clock for upstream expiry stamps (tests inject the harness clock). */
    now: () => Date;
    private seq;
    constructor(secret?: string);
    record(input: CreateInput): MockState;
    /** Simulates the payer paying (optionally a different amount). */
    pay(attemptNo: string, amountCents?: bigint, at?: Date): MockState;
    /** A signed callback body as the upstream would POST it. */
    callbackBody(attemptNo: string): string;
}
export declare function mockChannel(upstream: MockUpstream): ChannelAdapter;