/**
 * `zhifu/channels/adapters` — the built-in channel adapters (both modes): 中转站 `zhongzhuan` (also the relay),
 * 汇易通 `aggregator` (zyg1103), 支付宝直连 `alipay`, and the in-process `mock` (tests / demos; never real money).
 * Every one declares `handoff` and passes the `zhifu/handoff` contract kit. Credentials are Zod-parsed here.
 */
import type { ChannelFactory, ChannelKind } from "../types.ts";
import { type MockUpstream } from "./mock.ts";
export * from "../wire.ts";
export * from "./alipay.ts";
export * from "./alipay-sign.ts";
export * from "./huiyitong.ts";
export * from "./mock.ts";
export * from "./zhongzhuan.ts";
/** Built-in factories; `mock` only when a MockUpstream is given (tests, standalone demo). */
export declare function builtinChannelFactories(mock?: MockUpstream): Partial<Record<ChannelKind, ChannelFactory>>;