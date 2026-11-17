/**
 * `zhifu/handoff` — channel hand-off standard (owner 2026-11-04, INTEGRATION §6.0): what the payment company may
 * see of an order. Pure policy + the single create path `createUnderHandoff` + the adapter contract kit.
 * Used by zhifu-service (center) and `zhifu/server` (standalone) alike.
 */
export * from "./config-check.ts";
export * from "./contract.ts";
export * from "./create.ts";
export * from "./policy.ts";