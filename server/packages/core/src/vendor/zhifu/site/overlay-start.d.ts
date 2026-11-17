/**
 * 6.6 `siteStartResult`: sites already on the `zhifu/site` facade answer the overlay's `POST /api/pay/create`
 * by mapping their unchanged `createOrder(...)` result — book, tiers, slider redeem, reuse, notify all stay as is.
 */
import type { PayStartResult } from "../contracts/pay-create.ts";
import type { SiteCreateResult } from "./types.ts";
/**
 * `SiteCreateResult` → the overlay's start answer. `centerUrl` = the public center (https). An accepted order
 * without an overlay token (center older than 6.5) is refused rather than half-shown.
 */
export declare function siteStartResult(r: SiteCreateResult, centerUrl: string): PayStartResult;