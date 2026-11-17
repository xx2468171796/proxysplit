import type { CreateOrderInput, OrderRef, OrderView } from "./client.ts";
import { PayServiceError } from "./errors.ts";
/**
 * In-memory stand-in for zhifu-service in site tests: same surface as `createPayClient`, plus `pay()` which
 * returns a correctly signed notify body to feed into your own notify route. No network, no timers.
 */
export declare function createMockCenter(opts: {
    appId: string;
    secret: string;
    now?: () => Date;
    /** 4.6: one open order per player like the real service (default true). */
    singleOpen?: boolean;
}): {
    client: {
        createOrder: (input: CreateOrderInput) => Promise<OrderView>;
        tryCreateOrder: (input: CreateOrderInput) => Promise<{
            ok: true;
            value: OrderView;
            error?: undefined;
        } | {
            ok: false;
            error: PayServiceError;
            value?: undefined;
        }>;
        query: (ref: OrderRef) => Promise<OrderView>;
        cancel: (ref: OrderRef) => Promise<OrderView>;
        resume: (ref: OrderRef) => Promise<OrderView>;
        check: (ref: OrderRef) => Promise<OrderView>;
        lines: () => Promise<{
            lines: {
                id: string;
                name: string;
                usable: boolean;
                reason: null;
                recommended: boolean;
            }[];
        }>;
        payRules: () => Promise<{
            rules: {
                enabled: boolean;
                baseIntervalSec: number;
                ladderSec: number[];
                banAfterUnpaid: number;
            };
            lines: string[];
            queue: {
                enabled: boolean;
                wait_ms: number;
                ahead: number;
                text: string;
            };
        }>;
        queue: () => Promise<{
            enabled: boolean;
            wait_ms: number;
            ahead: number;
            text: string;
        }>;
        queuePoll: () => Promise<{
            ready: true;
            position: number;
            eta_ms: number;
            text: string;
        }>;
        payStatus: () => Promise<{
            outage: false;
            ui: null;
        }>;
        refund: (input: {
            orderNo: string;
            refundNo: string;
            amountCents: number;
        }) => Promise<{
            refund_no: string;
            status: "succeeded";
            amount_cents: number;
        }>;
    };
    pay: (orderNo: string) => string;
    /** Make the next createOrder fail with this code once (e.g. "COOLDOWN", "QUEUE_FULL", "PAY_BANNED"). */
    failNext: (code: PayServiceError["code"], message?: string, details?: Record<string, unknown>) => void;
};