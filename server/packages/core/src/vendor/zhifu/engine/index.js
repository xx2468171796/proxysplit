/**
 * `zhifu/engine` — the pure core of the order lifecycle (both pay modes): order / piece state machine (money that
 * arrived always wins; a paid piece is a duplicate), split plan in bigint cents, notify outbox backoff (72 h → dead,
 * `{code:0}` ack), QR expiry. Persistence and the atomic settle claim are host ports (see DESIGN-two-modes.md §5).
 */
export * from "./notify-backoff.js";
export * from "./order-state.js";
export * from "./qr-expiry.js";
export * from "./split.js";
export * from "./settle.js";
export * from "./attempt.js";
