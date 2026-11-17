import type { ChannelAdapter, CreateInput } from "../channels/types.ts";
/**
 * Adapter contract kit (both modes): run `adapter.create` with a capturing `fetch`, then check the wire against
 * the hand-off standard and the adapter's own `handoff` declaration. Framework-free: returns problems ([] = OK)
 * so any test runner can assert on it. Every adapter — center or standalone, built-in or project-local — must
 * pass `checkHandoffWire` before it may create real orders.
 */
export interface HandoffWire {
    /** Upstream URLs called (server-side fetch, plus a browser-side signed pay URL on the API host). */
    urls: string[];
    /** Every field value that left the process. */
    values: string[];
}
/** Every leaf value of a JSON text (deep). */
export declare function jsonValues(text: string): string[];
/**
 * Calls `adapter.create(input)` with `globalThis.fetch` swapped for a recorder (restored afterwards).
 * `apiHost` = the channel API host: a signed pay URL on it (browser-side APIs) counts as wire too.
 * `extraValues` = values an in-process adapter (mock) recorded itself. Sequential only: a second concurrent
 * capture throws. Adapters must call upstream through global `fetch` (undici / node:https would be invisible —
 * an empty wire fails the notify / subject checks).
 */
export declare function captureHandoffWire(adapter: ChannelAdapter, input: CreateInput, opts?: {
    apiHost?: string;
    respond?: () => Response;
    extraValues?: () => readonly string[];
}): Promise<HandoffWire>;
export interface WireCheck {
    adapter: Pick<ChannelAdapter, "handoff">;
    input: CreateInput;
    wire: HandoffWire;
    centerBase: string;
    apiHost?: string;
    /** Extra renderings of `input.expiresAt` the upstream uses — REQUIRED for Alipay (Beijing "yyyy-MM-dd HH:mm:ss"),
     * otherwise an adapter that does send the expiry is reported as not matching its declaration. */
    expiryTexts?: readonly string[];
}
/** Problems of one captured create call; [] = the adapter honours the hand-off standard and its declaration. */
export declare function checkHandoffWire(c: WireCheck): string[];