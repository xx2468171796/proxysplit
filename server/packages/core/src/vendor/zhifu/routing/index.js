/**
 * `zhifu/routing` — channel routing (both pay modes): per-channel rules (amount / caps / windows / pause / breaker,
 * Zod schema with tolerant runtime parse), amount routes, the four routing modes (round robin, weighted round robin,
 * priority failover, random) and the live-status explanation. Pure; facts (paid today, open attempts …) and the
 * rotation cursor are the host's I/O.
 */
export * from "./live.js";
export * from "./routing.js";
export * from "./rules.js";
export * from "./schema.js";
