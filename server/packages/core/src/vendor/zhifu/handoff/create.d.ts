import type { ChannelAdapter, CreateResult } from "../channels/types.ts";
import { type HandoffSource } from "./policy.ts";
/**
 * The single upstream-create path (orders + channel tests): builds the hand-off input under the standard and
 * refuses to call the adapter when it still violates it (fail closed — nothing leaks, the breaker counts it).
 * A throwing adapter becomes `ok: false` like any other failure.
 */
export declare function createUnderHandoff(adapter: ChannelAdapter, source: HandoffSource): Promise<CreateResult>;