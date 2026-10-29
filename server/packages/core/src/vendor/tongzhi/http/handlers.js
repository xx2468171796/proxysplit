import { withErrorKinds } from "./error-kind.js";
export { kindOfStatus } from "./error-kind.js";
/**
 * 框架无关 HTTP 处理器:宿主只做「鉴权 + 把 {method, path, query, body} 递进来 + 把 {status, body} 写回去」。
 *
 * 玩家侧 mount 在 /api/tongzhi,管理侧 mount 在 /api/admin/tongzhi;path 是相对 mount 点的剩余部分(以 / 开头)。
 * 两侧各一个 dispatcher,Next.js 用 catch-all 路由一行绑完;Express / Fastify 同理。
 *
 * 契约(玩家侧,宿主鉴权后给 PlayerContext):
 *   GET  /bundle?inboxLimit=      首屏一把拿齐:unread / inbox / popups / marquee / banners / toasts
 *   GET  /feed?surface=&unreadOnly=&includeArchived=&kind=&limit=&cursor=
 *   GET  /unread
 *   POST /seen        {ids}      POST /read {ids}      POST /read-all      POST /archive {ids}
 *   POST /dismiss     {id, hours?}                     POST /popup-shown   {id}
 * 契约(管理侧,宿主鉴权后给 Actor):
 *   GET    /notices?status=&phase=&kind=&surface=&batchId=&q=&limit=&cursor=
 *   POST   /notices              NoticeInput + {publish?}        GET /notices/:id     PUT /notices/:id     DELETE /notices/:id
 *   POST   /notices/:id/publish  POST /notices/:id/revoke        GET /notices/:id/stats
 *   POST   /batches/:batchId/revoke
 *   POST   /preview  NoticeInput          POST /send  SendInput
 *   GET    /templates                     POST /templates/:key/render {vars}
 *   POST   /purge {olderThanDays}         GET  /status
 */
import { noticeToPlayerWire, noticeToWire, receiptToWire } from "../core/logic.js";
import { plainText } from "../core/markdown.js";
import { TongzhiError } from "../types.js";
export const HTTP_STATUS_BY_CODE = {
    NOT_FOUND: 404, INVALID_INPUT: 400, INVALID_STATE: 409, UNAUTHORIZED: 401, SIGNATURE_INVALID: 401, REPLAY: 409,
};
export function feedItemToWire(it, now) {
    return { notice: noticeToPlayerWire(it.notice, now), receipt: receiptToWire(it.receipt), payload: it.payload, summary: plainText(it.notice.body || it.notice.title) };
}
export function bundleToWire(b, now) {
    const w = (xs) => xs.map((it) => feedItemToWire(it, now));
    return { unread: b.unread, inbox: w(b.inbox), popups: w(b.popups), marquee: w(b.marquee), banners: w(b.banners), toasts: w(b.toasts), serverTime: now.toISOString() };
}
const q1 = (q, k) => { const v = q?.[k]; return Array.isArray(v) ? v[0] : v; };
const qBool = (q, k) => ["1", "true", "yes"].includes(String(q1(q, k) ?? "").toLowerCase());
const qNum = (q, k) => { const v = q1(q, k); return v == null || v === "" ? undefined : Number(v); };
const idsOf = (body) => {
    const b = body;
    const ids = b?.ids;
    const arr = Array.isArray(ids) ? ids : b?.id != null ? [b.id] : [];
    return arr.map((x) => String(x)).filter(Boolean).slice(0, 200);
};
function wrap(fn) {
    return fn().then((body) => ({ status: 200, body })).catch((err) => {
        if (err instanceof TongzhiError)
            return { status: HTTP_STATUS_BY_CODE[err.code], body: { code: err.code, message: err.message } };
        throw err;
    });
}
const notFound = () => ({ status: 404, body: { code: "NOT_FOUND", message: "no such route" } });
const segs = (path) => path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(decodeURIComponent);
function createPlayerHandlers(tz) {
    const now = () => tz.now();
    return {
        bundle: (ctx, q) => wrap(async () => bundleToWire(await tz.bundle(ctx, { inboxLimit: qNum(q, "inboxLimit") }), now())),
        feed: (ctx, q) => wrap(async () => {
            const page = await tz.feed(ctx, {
                surface: q1(q, "surface"), surfaces: q1(q, "surfaces")?.split(",").filter(Boolean) || undefined, kind: q1(q, "kind"), unreadOnly: qBool(q, "unreadOnly"), includeArchived: qBool(q, "includeArchived"),
                limit: qNum(q, "limit"), cursor: q1(q, "cursor") ?? null,
            });
            const t = now();
            return { items: page.items.map((it) => feedItemToWire(it, t)), nextCursor: page.nextCursor };
        }),
        unread: (ctx) => wrap(async () => ({ unread: await tz.unreadCount(ctx) })),
        seen: (ctx, body) => wrap(async () => { await tz.markSeen(ctx.userId, idsOf(body)); return { ok: true }; }),
        read: (ctx, body) => wrap(async () => { await tz.markRead(ctx.userId, idsOf(body)); return { ok: true, unread: await tz.unreadCount(ctx) }; }),
        readAll: (ctx) => wrap(async () => ({ ok: true, count: await tz.markAllRead(ctx), unread: 0 })),
        archive: (ctx, body) => wrap(async () => { await tz.archive(ctx.userId, idsOf(body)); return { ok: true, unread: await tz.unreadCount(ctx) }; }),
        dismiss: (ctx, body) => wrap(async () => {
            const b = (body ?? {});
            if (!b.id)
                throw new TongzhiError("INVALID_INPUT", "缺 id");
            const hours = b.hours == null ? undefined : Number(b.hours);
            const until = await tz.dismiss(ctx.userId, String(b.id), { hours: hours !== undefined && Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 365) : undefined });
            return { ok: true, until: until.toISOString() };
        }),
        popupShown: (ctx, body) => wrap(async () => {
            const b = (body ?? {});
            if (!b.id)
                throw new TongzhiError("INVALID_INPUT", "缺 id");
            await tz.popupShown(ctx.userId, String(b.id));
            return { ok: true };
        }),
    };
}
function createAdminHandlers(tz, opts) {
    const now = () => tz.now();
    return {
        list: (q) => wrap(async () => {
            const page = await tz.list({
                status: q1(q, "status"), phase: q1(q, "phase"), kind: q1(q, "kind"), surface: q1(q, "surface"),
                batchId: q1(q, "batchId"), q: q1(q, "q"), limit: qNum(q, "limit"), cursor: q1(q, "cursor") ?? null,
            });
            const t = now();
            return { items: page.items.map((n) => noticeToWire(n, t)), nextCursor: page.nextCursor };
        }),
        get: (id) => wrap(async () => noticeToWire(await tz.get(id), now())),
        create: (actor, body) => wrap(async () => {
            const b = (body ?? {});
            const { publish, ...input } = b;
            return noticeToWire(await tz.create(input, actor, { publish: Boolean(publish) }), now());
        }),
        update: (actor, id, body) => wrap(async () => noticeToWire(await tz.update(id, (body ?? {}), actor), now())),
        remove: (actor, id) => wrap(async () => ({ ok: await tz.remove(id, actor) })),
        publish: (actor, id) => wrap(async () => noticeToWire(await tz.publish(id, actor), now())),
        revoke: (actor, id) => wrap(async () => noticeToWire(await tz.revoke(id, actor), now())),
        revokeBatch: (actor, batchId) => wrap(async () => ({ batchId, count: await tz.revokeBatch(batchId, actor) })),
        stats: (id) => wrap(() => tz.stats(id)),
        preview: (body) => wrap(async () => {
            const p = await tz.preview((body ?? {}));
            return { ...p, notice: { ...p.notice, startAt: p.notice.startAt?.toISOString() ?? null, endAt: p.notice.endAt?.toISOString() ?? null } };
        }),
        send: (actor, body) => wrap(async () => noticeToWire(await tz.send((body ?? {}), actor), now())),
        templates: () => wrap(async () => tz.templates()),
        renderTemplate: (key, body) => wrap(async () => tz.fromTemplate(key, (body ?? {}).vars ?? {})),
        purge: (actor, body) => wrap(async () => {
            const b = (body ?? {});
            const days = b.olderThanDays == null ? undefined : Number(b.olderThanDays);
            const r = await tz.purge({ olderThanDays: days !== undefined && Number.isFinite(days) && days > 0 ? days : undefined }, actor);
            return { count: r.count, before: r.before.toISOString() };
        }),
        status: () => wrap(async () => {
            const t = now();
            // 一次聚合拿五个阶段;countsExact=false 表示宿主 store 没实现 countByPhase,每阶段最多显示 100
            const { counts, exact } = await tz.countByPhase();
            return { version: opts.version ?? "tongzhi", serverTime: t.toISOString(), counts, countsExact: exact, templates: tz.templates().map((x) => x.key) };
        }),
    };
}
function buildTongzhiHttpHandlers(opts) {
    const tz = opts.tongzhi;
    const player = createPlayerHandlers(tz);
    const admin = createAdminHandlers(tz, opts);
    /** 玩家侧路由分发 */
    async function dispatchPlayer(req, ctx) {
        const s = segs(req.path);
        const m = req.method.toUpperCase();
        if (m === "GET" && s[0] === "bundle")
            return player.bundle(ctx, req.query);
        if (m === "GET" && s[0] === "feed")
            return player.feed(ctx, req.query);
        if (m === "GET" && s[0] === "unread")
            return player.unread(ctx);
        if (m === "POST" && s[0] === "seen")
            return player.seen(ctx, req.body);
        if (m === "POST" && s[0] === "read")
            return player.read(ctx, req.body);
        if (m === "POST" && s[0] === "read-all")
            return player.readAll(ctx);
        if (m === "POST" && s[0] === "archive")
            return player.archive(ctx, req.body);
        if (m === "POST" && s[0] === "dismiss")
            return player.dismiss(ctx, req.body);
        if (m === "POST" && s[0] === "popup-shown")
            return player.popupShown(ctx, req.body);
        return notFound();
    }
    /** 管理侧路由分发(鉴权在宿主;actor 由宿主给) */
    async function dispatchAdmin(req, actor) {
        const s = segs(req.path);
        const m = req.method.toUpperCase();
        if (s[0] === "notices") {
            if (s.length === 1)
                return m === "GET" ? admin.list(req.query) : m === "POST" ? admin.create(actor, req.body) : notFound();
            const id = s[1] ?? ""; // 走到这里 s.length >= 2,恒有值
            if (s.length === 2)
                return m === "GET" ? admin.get(id) : m === "PUT" || m === "PATCH" ? admin.update(actor, id, req.body) : m === "DELETE" ? admin.remove(actor, id) : notFound();
            if (s.length === 3) {
                if (m === "POST" && s[2] === "publish")
                    return admin.publish(actor, id);
                if (m === "POST" && s[2] === "revoke")
                    return admin.revoke(actor, id);
                if (m === "GET" && s[2] === "stats")
                    return admin.stats(id);
            }
            return notFound();
        }
        if (s[0] === "batches" && s.length === 3 && s[2] === "revoke" && m === "POST")
            return admin.revokeBatch(actor, s[1] ?? ""); // s.length === 3,恒有值
        if (s[0] === "preview" && m === "POST")
            return admin.preview(req.body);
        if (s[0] === "send" && m === "POST")
            return admin.send(actor, req.body);
        if (s[0] === "templates") {
            if (s.length === 1 && m === "GET")
                return admin.templates();
            if (s.length === 3 && s[2] === "render" && m === "POST")
                return admin.renderTemplate(s[1] ?? "", req.body); // s.length === 3,恒有值
            return notFound();
        }
        if (s[0] === "purge" && m === "POST")
            return admin.purge(actor, req.body);
        if (s[0] === "status" && m === "GET")
            return admin.status();
        return notFound();
    }
    return { player, admin, dispatchPlayer, dispatchAdmin };
}
/** 把 URLSearchParams / Next.js searchParams 变成 handler 的 query 形状 */
export function queryFromSearchParams(sp) {
    const out = {};
    sp.forEach((v, k) => { out[k] = v; });
    return out;
}
/** 对外的处理器：错误体统一带 kind（error-kind.ts，公司基础契约 jichu 的 ErrorBody） */
export function createTongzhiHttpHandlers(opts) {
    return withErrorKinds(buildTongzhiHttpHandlers(opts));
}
