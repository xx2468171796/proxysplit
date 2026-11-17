import { notifyHandler } from "./notify.js";
/**
 * Fastify: `registerNotifyRoute(app, { path: "/api/pay/center-notify", appId, secret, onPaid })`.
 * Verifies signature + timestamp, dedupes by notify_id, calls onPaid, replies `{"code":0}` only on success.
 */
export function registerNotifyRoute(app, options) {
    const handle = notifyHandler(options);
    app.register(async (scope) => {
        scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
        scope.post(options.path, async (req, reply) => {
            const out = await handle(typeof req.body === "string" ? req.body : "");
            return reply.code(out.status).header("content-type", "application/json").send(out.body);
        });
    });
}
/** Plain Node `http` (Express / Koa / raw): `(req, res) => void`. Reads the raw body itself (≤ 64 KB). */
export function nodeNotifyListener(options) {
    const handle = notifyHandler(options);
    return (req, res) => {
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
            size += c.length;
            if (size > 65536)
                req.destroy();
            else
                chunks.push(c);
        });
        req.on("end", () => {
            void handle(Buffer.concat(chunks).toString("utf8")).then((out) => {
                res.writeHead(out.status, { "content-type": "application/json" });
                res.end(out.body);
            });
        });
    };
}
