import { type ScanClientIn, type ScanPage, type StandalonePayOptions } from "../server/service.ts";
import { type StandaloneJobOptions } from "../server/jobs.ts";
import type { StandaloneOrder } from "../server/types.ts";
import type { ModeSide } from "./center.ts";
import type { PaidEvent } from "./types.ts";
/**
 * 6.0.0: `createSitePay({ mode: "standalone" })` runs the shared standalone pipeline (`zhifu/server`: scan gate,
 * routing, hand-off standard, `settleWith`) instead of the legacy `createPaymentKit`. The app mounts three routes
 * from `SitePay.embedded` (or uses the `zhifuStandalone` Fastify plugin): `GET /s/:token`, `POST /channel-callback/:code`
 * and its admin. Center-only features (cross-site queue, cooldown ladder, split) do not exist here: `queue` is off.
 */
export type StandaloneSideOptions = Omit<StandalonePayOptions, "onPaid"> & {
    /** Sweeper + 35-day retention in this process (default on; `false` when another process runs them). */
    jobs?: StandaloneJobOptions | false;
};
export interface EmbeddedPay {
    /** `GET /s/:token` → send `html` with `status` (and `HANDOFF_HEADERS` from `zhifu/scan`). */
    scan(token: string, client: ScanClientIn): Promise<ScanPage>;
    /** `POST /channel-callback/:code` with the raw body; reply `status` / `body` as text. */
    callback(code: string, rawBody: string, headers: Readonly<Record<string, string | undefined>>): Promise<{
        status: number;
        body: string;
    }>;
}
export declare function eventOf(order: StandaloneOrder): PaidEvent;
export declare function createStandaloneSide(o: StandaloneSideOptions, onPaid: (e: PaidEvent) => Promise<void>): ModeSide & {
    embedded: EmbeddedPay;
    stop(): void;
};