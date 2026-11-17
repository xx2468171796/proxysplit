import type { ChannelLiveDto } from "./schema.ts";
import { type ChannelFacts, type ChannelRule } from "./rules.ts";
export interface LiveInput {
    enabled: boolean;
    weight: number;
    hasCredentials: boolean;
    rule: ChannelRule;
    facts: ChannelFacts;
    /** chan.health state (open = auto-paused by the breaker). */
    healthState: "closed" | "open" | "half_open" | null;
    /** Pinned 中转站 channel inactive (null = unknown / not pinned). */
    gatewayActive: boolean | null;
    now: Date;
}
/** 已启用 is the switch; 生效中 = enabled AND healthy AND in window AND under caps. Pure, every reason listed. */
export declare function liveStatus(i: LiveInput): ChannelLiveDto;