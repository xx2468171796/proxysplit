import type { IncomingMessage, ServerResponse } from "node:http";
import { type NotifyHandlerOptions } from "./notify.ts";
/**
 * Minimal structural view of a Fastify instance (no fastify dependency). The notify route needs the RAW body
 * for the signature, so the plugin registers its own string parser inside an encapsulated scope.
 */
interface FastifyLike {
    register(plugin: (scope: FastifyLike) => Promise<void>): unknown;
    addContentTypeParser(type: string, opts: {
        parseAs: "string";
    }, parser: (req: unknown, body: string, done: (err: Error | null, body?: unknown) => void) => void): void;
    post(path: string, handler: (req: {
        body: unknown;
    }, reply: {
        code(n: number): {
            header(k: string, v: string): {
                send(b: string): unknown;
            };
        };
    }) => Promise<unknown>): void;
}
/**
 * Fastify: `registerNotifyRoute(app, { path: "/api/pay/center-notify", appId, secret, onPaid })`.
 * Verifies signature + timestamp, dedupes by notify_id, calls onPaid, replies `{"code":0}` only on success.
 */
export declare function registerNotifyRoute(app: FastifyLike, options: NotifyHandlerOptions & {
    path: string;
}): void;
/** Plain Node `http` (Express / Koa / raw): `(req, res) => void`. Reads the raw body itself (≤ 64 KB). */
export declare function nodeNotifyListener(options: NotifyHandlerOptions): (req: IncomingMessage, res: ServerResponse) => void;
export {};