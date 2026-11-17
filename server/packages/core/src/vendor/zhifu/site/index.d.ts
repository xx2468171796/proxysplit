import { type LocalPayConfig, type PayConfigSync } from "../center/pay-config.ts";
import { type CenterSideOptions } from "./center.ts";
import { type StandaloneSideOptions } from "./standalone.ts";
import type { PaidEvent, PayMode, SitePay } from "./types.ts";
export { memoryOrderBook, requestOrderNo, type CenterSideOptions } from "./center.ts";
export { siteStartResult } from "./overlay-start.ts";
export { DEFAULT_HV_URL, type HumanVerdict, type HumanVerifyOptions, redeemHumanToken } from "./human-verify.ts";
export type { EmbeddedPay, StandaloneSideOptions } from "./standalone.ts";
export type * from "./types.ts";
export interface SitePayOptions {
    mode: PayMode;
    /** The one fulfil hook for both modes. Must be idempotent on `e.idempotencyKey`. */
    onPaid(e: PaidEvent): Promise<void>;
    /** Site fallback tiers / min / max, used when the central pay-config is unreachable or not configured. */
    local: () => LocalPayConfig | Promise<LocalPayConfig>;
    center?: CenterSideOptions & {
        /** For the central pay-config pull (also used in standalone mode when given). */
        baseUrl?: string;
        snapshotFile?: string | null;
    };
    standalone?: StandaloneSideOptions;
    /** Override the pay-config source (tests). Default: central pull when center.baseUrl is set, else local only. */
    payConfig?: Pick<PayConfigSync, "get" | "tiers" | "checkAmount">;
    onLog?: (msg: string, err?: unknown) => void;
}
export declare function createSitePay(o: SitePayOptions): SitePay;
/** The env keys `createSitePayFromEnv` reads (put them in runtime env; secrets never in git). */
export interface SitePayEnv {
    /** "center" | "standalone". Unset: center when PAY_CENTER_APP_ID is set, else standalone. */
    PAY_MODE?: string;
    PAY_CENTER_URL?: string;
    PAY_CENTER_APP_ID?: string;
    PAY_CENTER_SECRET?: string;
    /** 4.12: the site's public host for pay-time human verification (tokens are bound to it). Unset = hvToken ignored. */
    PAY_HV_HOST?: string;
    /** 4.12: verification service URL (default http://127.0.0.1:8976, sz local). */
    PAY_HV_URL?: string;
}
export declare function payModeFromEnv(env: SitePayEnv): PayMode;
/**
 * Env-driven wiring: switching mode = change PAY_MODE + restart. Center credentials (when present) are always
 * wired, so center notifies keep crediting after a switch back to standalone; `standalone` is built only when
 * given (pass it lazily when the mode is standalone or while migrating).
 */
export declare function createSitePayFromEnv(env: SitePayEnv, deps: Omit<SitePayOptions, "mode" | "center"> & {
    book?: CenterSideOptions["book"];
    centerExtras?: Omit<CenterSideOptions, "appId" | "secret" | "client" | "book"> & {
        snapshotFile?: string | null;
    };
}): SitePay;