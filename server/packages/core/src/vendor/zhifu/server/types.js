import { z } from "zod";
const scanRules = z.object({
    alipayOnly: z.boolean().default(true),
    allowPhoneBrowser: z.boolean().default(true),
    allowTablet: z.boolean().default(true),
    minScanDelayMs: z.number().int().min(0).max(60000).default(1500),
    windowMin: z.number().int().min(1).max(1440).default(10),
    maxPerIp: z.number().int().min(0).max(1000).default(10),
    maxPerDevice: z.number().int().min(0).max(1000).default(5),
    maxPerPlayer: z.number().int().min(0).max(1000).default(5),
    ipGate: z.boolean().default(true),
    blockOverseas: z.boolean().default(true),
    blockHkMoTw: z.boolean().default(true),
    blockUnknownGeo: z.boolean().default(false),
});
/** Admin knobs (same meaning and defaults as the center's 开关总台 / 风控 / 通道异常 settings). */
export const standaloneKnobsSchema = z.object({
    /** 收款 on / off + the text players see when off. */
    collection: z.boolean().default(true),
    collectionText: z.string().trim().max(200).default("充值通道维护中，请联系客服充值"),
    minAmountCents: z.number().int().min(1).max(100000000).default(100),
    maxAmountCents: z.number().int().min(1).max(100000000).default(5000000),
    orderTtlSec: z.number().int().min(60).max(3600).default(300),
    scan: scanRules.default(scanRules.parse({})),
    /** No usable channel → refuse with the outage text at once (owner 11-04: no queue, no QR). */
    outageGate: z.boolean().default(true),
    outageTitle: z.string().trim().max(60).default("支付通道异常"),
    outageBody: z.string().trim().max(1000).default("支付渠道异常，正在抢修，恢复后会第一时间通知。"),
}).refine((k) => k.minAmountCents <= k.maxAmountCents, { message: "最低金额不能高于最高金额", path: ["minAmountCents"] });
export const DEFAULT_STANDALONE_KNOBS = standaloneKnobsSchema.parse({});
