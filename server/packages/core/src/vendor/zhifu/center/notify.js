import { verify } from "./sign.js";
export function memoryDedupe(max = 10000) {
    const ids = new Set();
    const add = (id) => {
        if (ids.size >= max)
            ids.clear();
        ids.add(id);
    };
    return {
        seen: async (id) => ids.has(id),
        mark: async (id) => add(id),
        claim: async (id) => {
            if (ids.has(id))
                return false;
            add(id);
            return true;
        },
        release: async (id) => {
            ids.delete(id);
        },
    };
}
export const ACK_BODY = '{"code":0}';
function parse(rawBody) {
    try {
        const parsed = JSON.parse(rawBody);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
}
function authentic(n, options) {
    const { sign, ...params } = n;
    if (n.app_id !== options.appId || typeof sign !== "string" || !verify(params, sign, options.secret))
        return false;
    return Math.abs(Date.now() / 1000 - Number(n.timestamp)) <= (options.maxSkewSec ?? 300);
}
/**
 * Framework-agnostic handler: give it the raw body, return its { status, body } as the HTTP response.
 * Verifies the signature and timestamp, dedupes by notify_id, calls your handler, then acks.
 * Anything but `{"code":0}` with 2xx makes the service retry (backoff up to 72h).
 */
export function notifyHandler(options) {
    const dedupe = options.dedupe ?? memoryDedupe();
    const reject = (status, message) => ({ status, body: JSON.stringify({ code: 1, message }) });
    async function dispatch(n) {
        if (n.event === "order.paid")
            await options.onPaid(n);
        else if (n.event === "order.refunded")
            await options.onRefunded?.(n);
        else if (n.event === "order.partial")
            await options.onPartial?.(n);
    }
    return async function handle(rawBody) {
        const n = parse(rawBody);
        if (!n)
            return reject(400, "bad json");
        if (!authentic(n, options))
            return reject(401, "bad signature or stale");
        const fresh = dedupe.claim ? await dedupe.claim(n.notify_id) : !(await dedupe.seen(n.notify_id));
        if (!fresh)
            return { status: 200, body: ACK_BODY };
        try {
            await dispatch(n);
        }
        catch (error) {
            if (dedupe.claim)
                await dedupe.release?.(n.notify_id);
            return reject(500, String(error).slice(0, 200));
        }
        if (!dedupe.claim)
            await dedupe.mark(n.notify_id);
        return { status: 200, body: ACK_BODY };
    };
}
