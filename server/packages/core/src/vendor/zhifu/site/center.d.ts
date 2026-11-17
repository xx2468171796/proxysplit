import { type HumanVerifyOptions } from "./human-verify.ts";
import type { PayClient } from "../center/client.ts";
import { type DedupeStore, type PaidNotification } from "../center/notify.ts";
import type { NotifyReply, PaidEvent, SiteCreateInput, SiteCreateResult, SiteOrderBook, SiteOrderRecord, SiteOrderState, SiteQueue, SitePayStatus, SiteQueuePoll } from "./types.ts";
export interface CenterSideOptions {
    appId: string;
    secret: string;
    /** `createPayClient(...)` or `createMockCenter(...).client`. */
    /** `payStatus` optional (5.16) so older fakes / wrappers keep compiling; missing = always open. */
    client: Omit<PayClient, "payStatus"> & Partial<Pick<PayClient, "payStatus">>;
    /** Remembers user / amount / meta per site order (unique on site_order_no). */
    book: SiteOrderBook;
    /** Production: DB-backed (`claim` = insert … on conflict do nothing). Default in-memory. */
    dedupe?: DedupeStore;
    /** Site order number prefix (default "C"); ≤ 64 chars total. */
    orderPrefix?: string;
    onRefunded?(n: PaidNotification): Promise<void>;
    onPartial?(n: PaidNotification): Promise<void>;
    /** 4.12: redeem `SiteCreateInput.hvToken` at the central human-verification service before creating. */
    humanVerify?: HumanVerifyOptions;
}
export interface ModeSide {
    createOrder(input: SiteCreateInput): Promise<SiteCreateResult>;
    getOrder(userId: string, orderNo: string): Promise<SiteOrderState | null>;
    cancel(userId: string, orderNo: string): Promise<boolean>;
    resume(userId: string, orderNo: string): Promise<SiteCreateResult>;
    check(userId: string, orderNo: string): Promise<SiteOrderState | null>;
    rulesLines(): Promise<string[]>;
    queue(): Promise<SiteQueue>;
    queuePoll(player: {
        userId: string;
        phone?: string | undefined;
        huiyuanId?: string | undefined;
    }): Promise<SiteQueuePoll>;
    payStatus(): Promise<SitePayStatus>;
}
/** 6.7.1: same (user, requestId) → same number; `R` marks request-derived numbers. Invalid ids fall back to random. */
export declare function requestOrderNo(prefix: string, userId: string, requestId: string | undefined): string | null;
export declare function createCenterSide(o: CenterSideOptions): ModeSide;
/**
 * Center notify → PaidEvent. The local record must exist, belong to the notified player and match the paid
 * amount; anything else throws, so the service keeps retrying and alerts (never auto-credit a mismatch).
 */
export declare function createCenterNotify(o: CenterSideOptions, onPaid: (e: PaidEvent) => Promise<void>): (rawBody: string) => Promise<NotifyReply>;
/** In-memory SiteOrderBook for tests and demos (not for production: lost on restart). */
export declare function memoryOrderBook(): SiteOrderBook & {
    rows: Map<string, SiteOrderRecord>;
    discarded: Map<string, string>;
};