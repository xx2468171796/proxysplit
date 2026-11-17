import { z } from "zod";
/**
 * Global channel routing (owner 11-01 「轮询方式」). Stored as peizhi json param `channel.routing`,
 * edited from the 通道 page (high-risk `channel:configure` + audit). Per-channel weight / priority /
 * limits stay on the channel row; this only says how to choose among the channels that pass their rules.
 */
export const ROUTING_MODES = ["round_robin", "weighted_round_robin", "priority_failover", "random"];
export const ROUTING_MODE_LABEL = {
    round_robin: "轮询（逐个轮流，忽略权重）",
    weighted_round_robin: "加权轮询（按权重比例轮流）",
    priority_failover: "优先级 + 故障转移（最小优先级一档内按权重随机，整档不可用才用下一档）",
    random: "随机（可用通道里等概率）",
};
/** Amount → channel rule: an order whose amount matches is only routed to `channels` (codes). */
export const amountRouteSchema = z
    .object({
    label: z.string().trim().max(40).default(""),
    minCents: z.number().int().nonnegative().optional(),
    maxCents: z.number().int().nonnegative().optional(),
    /** Exact amounts (cents); non-empty = matches only these amounts (min / max ignored). */
    fixedCents: z.array(z.number().int().positive()).max(50).default([]),
    channels: z.array(z.string().min(1).max(32)).min(1).max(50),
})
    .refine((r) => r.minCents === undefined || r.maxCents === undefined || r.minCents <= r.maxCents, "最低不能高于最高");
export const channelRoutingSchema = z.object({
    mode: z.enum(ROUTING_MODES),
    /** First matching rule wins; no match = all channels. */
    amountRoutes: z.array(amountRouteSchema).max(30).default([]),
});
/** Default = the behaviour before 11-01 (lowest priority tier, weighted random inside it). */
export const DEFAULT_CHANNEL_ROUTING = { mode: "priority_failover", amountRoutes: [] };
