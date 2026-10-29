import { TongzhiError } from "../types.js";
import { buildSignedHeaders, NONCE_TTL_SEC, verifySignature } from "./signature.js";
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** 只判外形(对象 + title 是字符串),字段细则交给 normalizeInput */
const isNoticeShape = (v) => isRecord(v) && typeof v.title === "string";
const bad = (msg) => new TongzhiError("INVALID_INPUT", msg);
/**
 * 推送报文在边界整形校验:验签只证明「是对方发的」,不证明「形状对」—— 对方站的 bug / 版本错位
 * 发来 `batchId: ["xs_a"]` 这种值,老写法会靠 String() 混过正则再在 service 里炸成 500。
 * 通知字段本身(标题长度、受众名单上限 5000、链接安全…)由 service 的 normalizeInput 统一校验,这里不重复。
 */
export function parsePushOp(raw) {
    if (!isRecord(raw))
        throw bad("body 必须是 JSON 对象");
    if (raw.op === "create")
        return parseCreate(raw);
    if (raw.op === "revoke")
        return parseRevoke(raw);
    if (raw.op === "revokeBatch")
        return parseRevokeBatch(raw);
    throw bad(`不支持的 op: ${typeof raw.op === "string" ? raw.op.slice(0, 32) : typeof raw.op}`);
}
function parseCreate(raw) {
    if (!isNoticeShape(raw.notice))
        throw bad("create.notice 必须是带 title 字符串的对象");
    if (raw.publish === undefined)
        return { op: "create", notice: raw.notice };
    if (typeof raw.publish !== "boolean")
        throw bad("create.publish 只能是布尔值");
    return { op: "create", notice: raw.notice, publish: raw.publish };
}
function parseRevoke(raw) {
    const id = raw.id;
    if (typeof id !== "string" || !id.trim() || id.length > 128)
        throw bad("revoke.id 必须是 1~128 字的字符串");
    return { op: "revoke", id };
}
function parseRevokeBatch(raw) {
    const batchId = raw.batchId;
    if (typeof batchId !== "string" || batchId.length > 64 || !/^xs_[a-z0-9_]+$/i.test(batchId))
        throw bad("跨站批次号形如 xs_…(≤ 64 字)");
    return { op: "revokeBatch", batchId };
}
export function createPushReceiver(o) {
    const allow = new Set(o.allowOps ?? ["create", "revoke", "revokeBatch"]);
    async function handle(req) {
        try {
            const siteHdr = req.headers["x-tz-site"];
            const site = String(Array.isArray(siteHdr) ? siteHdr[0] : siteHdr ?? "").trim();
            const secret = site ? await o.secretFor(site) : null;
            if (!secret)
                throw new TongzhiError("SIGNATURE_INVALID", "未知来源站或未配置密钥");
            const v = verifySignature({ secret, method: req.method, path: req.path, body: req.rawBody, headers: req.headers });
            if (!v.ok)
                throw new TongzhiError("SIGNATURE_INVALID", `签名校验失败: ${v.reason}`);
            let fresh = false;
            try {
                fresh = await o.nonces.claim(v.nonce, NONCE_TTL_SEC);
            }
            catch {
                fresh = false;
            }
            if (!fresh)
                throw new TongzhiError("REPLAY", "nonce 已用过或 nonce 存储不可用");
            let raw;
            try {
                raw = JSON.parse(req.rawBody);
            }
            catch {
                throw new TongzhiError("INVALID_INPUT", "body 不是 JSON");
            }
            const body = parsePushOp(raw);
            if (!allow.has(body.op))
                throw new TongzhiError("INVALID_INPUT", `不支持的 op: ${body.op}`);
            const actor = { id: `push:${site}`, source: `push:${site}` };
            if (body.op === "create") {
                const n = await o.tongzhi.create(body.notice, actor, { publish: body.publish !== false });
                return { status: 200, body: { ok: true, id: n.id, status: n.status } };
            }
            if (body.op === "revoke") {
                // 只能撤自己推过来的:本站自己发的通知不归中央管
                const cur = await o.tongzhi.get(body.id);
                if (cur.source !== `push:${site}`)
                    throw new TongzhiError("UNAUTHORIZED", "只能撤回本来源推送的通知");
                const n = await o.tongzhi.revoke(body.id, actor);
                return { status: 200, body: { ok: true, id: n.id } };
            }
            const count = await o.tongzhi.revokeBatch(body.batchId, actor, { source: `push:${site}` });
            return { status: 200, body: { ok: true, count } };
        }
        catch (err) {
            if (err instanceof TongzhiError) {
                const status = err.code === "SIGNATURE_INVALID" || err.code === "UNAUTHORIZED" ? 401 : err.code === "REPLAY" ? 409 : err.code === "NOT_FOUND" ? 404 : 400;
                return { status, body: { ok: false, code: err.code, message: err.message } };
            }
            throw err;
        }
    }
    return { handle };
}
export function createPushSender(o) {
    const f = o.fetch ?? globalThis.fetch;
    const self = o.self ?? "huiyuan";
    const byId = new Map(o.sites.map((s) => [s.slug, s]));
    async function pushOne(site, op) {
        const path = site.path ?? "/api/integrations/tongzhi/push";
        const body = JSON.stringify(op);
        const headers = buildSignedHeaders({ secret: site.secret, site: self, method: "POST", path, body });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 8000);
        try {
            const res = await f(`${site.baseUrl.replace(/\/$/, "")}${path}`, { method: "POST", headers, body, signal: ctrl.signal });
            const text = await res.text();
            let parsed = text;
            try {
                parsed = JSON.parse(text);
            }
            catch { /* keep text */ }
            return { slug: site.slug, ok: res.ok, status: res.status, body: parsed };
        }
        catch (err) {
            return { slug: site.slug, ok: false, status: 0, body: null, error: String(err?.message ?? err) };
        }
        finally {
            clearTimeout(timer);
        }
    }
    const pick = (slugs) => (slugs === "all" ? o.sites : slugs.map((s) => { const x = byId.get(s); if (!x)
        throw new TongzhiError("NOT_FOUND", `未知站点: ${s}`); return x; }));
    /** 同一条通知推到多站:每站独立 idemKey(`${idemKey}:${slug}`),共用 batchId */
    async function create(slugs, notice, opt = {}) {
        const batchId = opt.batchId ?? `xs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const baseIdem = notice.idemKey ?? batchId;
        const results = await Promise.all(pick(slugs).map((site) => pushOne(site, {
            op: "create", publish: opt.publish !== false,
            notice: { ...notice, batchId, idemKey: `${baseIdem}:${site.slug}` },
        })));
        return { batchId, results };
    }
    const revokeBatch = (slugs, batchId) => Promise.all(pick(slugs).map((site) => pushOne(site, { op: "revokeBatch", batchId })));
    const revoke = (slug, id) => pushOne(pick([slug])[0], { op: "revoke", id });
    return { create, revokeBatch, revoke, sites: () => o.sites.map((s) => ({ slug: s.slug, baseUrl: s.baseUrl })) };
}
