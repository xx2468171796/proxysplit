import { z } from "zod";
/**
 * Global channel routing (owner 11-01 「轮询方式」). Stored as peizhi json param `channel.routing`,
 * edited from the 通道 page (high-risk `channel:configure` + audit). Per-channel weight / priority /
 * limits stay on the channel row; this only says how to choose among the channels that pass their rules.
 */
export declare const ROUTING_MODES: readonly ["round_robin", "weighted_round_robin", "priority_failover", "random"];
export type RoutingMode = (typeof ROUTING_MODES)[number];
export declare const ROUTING_MODE_LABEL: Record<RoutingMode, string>;
/** Amount → channel rule: an order whose amount matches is only routed to `channels` (codes). */
export declare const amountRouteSchema: z.ZodObject<{
    label: z.ZodDefault<z.ZodString>;
    minCents: z.ZodOptional<z.ZodNumber>;
    maxCents: z.ZodOptional<z.ZodNumber>;
    fixedCents: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
    channels: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type AmountRoute = z.infer<typeof amountRouteSchema>;
export declare const channelRoutingSchema: z.ZodObject<{
    mode: z.ZodEnum<{
        round_robin: "round_robin";
        weighted_round_robin: "weighted_round_robin";
        priority_failover: "priority_failover";
        random: "random";
    }>;
    amountRoutes: z.ZodDefault<z.ZodArray<z.ZodObject<{
        label: z.ZodDefault<z.ZodString>;
        minCents: z.ZodOptional<z.ZodNumber>;
        maxCents: z.ZodOptional<z.ZodNumber>;
        fixedCents: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
        channels: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type ChannelRouting = z.infer<typeof channelRoutingSchema>;
/** Default = the behaviour before 11-01 (lowest priority tier, weighted random inside it). */
export declare const DEFAULT_CHANNEL_ROUTING: ChannelRouting;
/** Why a channel is (not) live right now: enabled AND healthy AND in window AND under caps. */
export interface ChannelLiveDto {
    live: boolean;
    /** Empty when live. */
    reasons: string[];
}