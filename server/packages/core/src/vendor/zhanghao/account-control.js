import { withErrorKinds } from "./http/error-kind.js";
/**
 * zhanghao/account-control —— 账号封禁的「AI 控制闸」(给跨站命令行 zhctl 用)。
 *
 * 业主 2026-10-15:「把封号的也变成包放在 zhanghao 里面,后续也方便」。起因是要按一个注册手机号
 * 封掉他在所有站的号,而各站封号各写各的(列不同、会话存法不同、有的不踢在线会话)。
 * 封禁本身早就在包里(`zh.admin.ban / unban`:写状态 → 吊销全部会话 → 幂等审计),
 * 这里只补「命令行能安全地调到它」的那一层,站点不再自己实现封号。
 *
 * 闸:与 tongzhi 的 AI 控制同一套口径 —— Bearer 令牌(≥32 位,常量时间比较)**且**来源 IP 是本机。
 * 令牌没配(或太短)= 整个闸关闭,所有请求 401;不存在「没配令牌就放行」的分支。
 *
 * 路由(宿主把 `/api/admin/zhanghao-ai/*` 整段转给 `dispatch`,路径传 `*` 那一段):
 *   GET  /status                       { enabled: true }(探活,zhctl status 用)
 *   GET  /accounts?phone=13800000000   该手机号注册的账号(精确匹配归一化后的号码,不是包含)
 *   GET  /accounts?userId=123          单个账号
 *   POST /accounts/:id/ban             { days: null | 1..3650, reason, requestId }   days=null 永久
 *   POST /accounts/:id/unban           { reason, requestId }
 *
 * 不封管理员(role=admin → 403):命令行打错一个号就把后台锁死,代价太大;要封管理员去后台先降级。
 */
import { timingSafeEqual } from "node:crypto";
import { HTTP_STATUS_BY_CODE } from "./http/wire.js";
import { adminUserView } from "./http/handlers.js";
import { normalizePhone } from "./identifier.js";
import { ZhanghaoError, isZhanghaoError } from "./types.js";
export const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const isLoopbackIp = (ip) => LOOPBACK_IPS.has(ip);
const PHONE_SEARCH_LIMIT = 50;
const REASON_MAX = 200;
const DAYS_MAX = 3650;
const first = (v) => (Array.isArray(v) ? v[0] : v);
function fail(message, detail) {
    throw new ZhanghaoError("VALIDATION", message, detail);
}
function obj(body) {
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}
function reasonOf(body) {
    const r = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!r)
        fail("必须写原因(reason),它会进审计,封禁时也是玩家登录看到的提示", { field: "reason" });
    if (r.length > REASON_MAX)
        fail(`原因最多 ${REASON_MAX} 字`, { field: "reason" });
    return r;
}
function requestIdOf(body) {
    const id = typeof body.requestId === "string" ? body.requestId.trim() : "";
    if (!id)
        fail("必须带 requestId(幂等锚,重试复用同一个)", { field: "requestId" });
    return id;
}
function daysOf(body) {
    const d = body.days;
    if (d === null || d === undefined)
        return null;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > DAYS_MAX) {
        fail(`days 只能是 null(永久)或 1..${DAYS_MAX} 的整数`, { field: "days" });
    }
    return d;
}
function buildZhanghaoAccountControl(zh, opts) {
    const minLen = opts.minTokenLength ?? 32;
    const token = typeof opts.token === "string" ? opts.token.trim() : "";
    const enabled = token.length >= minLen;
    const want = Buffer.from(token);
    const allowIp = opts.allowIp ?? isLoopbackIp;
    const actorHeader = (opts.actorHeader ?? "x-zh-actor").toLowerCase();
    const operatorOf = opts.operatorId ?? ((actor) => `ai:${actor}`);
    /** 通过返回调用方名字,不通过返回 null(不区分「令牌错」与「IP 不对」,别给探测者提示) */
    function authenticate(req) {
        if (!enabled)
            return null;
        const auth = first(req.headers.authorization);
        if (typeof auth !== "string" || !auth.startsWith("Bearer "))
            return null;
        if (!allowIp(req.ip))
            return null;
        const given = Buffer.from(auth.slice(7).trim());
        if (given.length !== want.length || !timingSafeEqual(given, want))
            return null;
        const raw = first(req.headers[actorHeader]) ?? "cli";
        const actor = String(raw).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 32) || "cli";
        return { actor };
    }
    async function listByPhone(raw) {
        const phone = normalizePhone(raw);
        if (!phone)
            fail("手机号格式不对", { field: "phone" });
        /* admin.search 的数字串语义是「userId 精确 或 手机号包含」;这里要的是「这个号注册的账号」,
           所以拿回来再按归一化后的号码**精确**过滤,包含匹配和恰好同数字的 userId 都不算。 */
        const rows = await zh.admin.search({ query: phone, limit: PHONE_SEARCH_LIMIT });
        return rows.filter((u) => u.phone !== null && normalizePhone(u.phone) === phone).map(adminUserView);
    }
    async function mustNotBeAdmin(userId) {
        const u = await zh.admin.get(userId);
        if (u.role === "admin")
            throw new ZhanghaoError("FORBIDDEN", "不能通过命令行封禁管理员,请先在后台降级");
    }
    function toError(err) {
        if (isZhanghaoError(err) && HTTP_STATUS_BY_CODE[err.code] !== undefined) {
            const body = { code: err.code, message: err.message };
            if (err.detail)
                body.detail = err.detail;
            return { status: HTTP_STATUS_BY_CODE[err.code], body };
        }
        opts.onInternalError?.(err);
        return { status: 500, body: { code: "INTERNAL", message: "服务暂时不可用" } };
    }
    async function dispatch(req) {
        const who = authenticate(req);
        if (!who)
            return { status: 401, body: { code: "TOKEN_INVALID", message: "未授权" } };
        const method = req.method.toUpperCase();
        const parts = req.path.split("/").filter(Boolean);
        try {
            if (method === "GET" && parts.length === 1 && parts[0] === "status") {
                return { status: 200, body: { enabled: true } };
            }
            if (method === "GET" && parts.length === 1 && parts[0] === "accounts") {
                const q = req.query ?? {};
                // Fastify / Express 遇到重复参数会给数组;只认单个字符串
                const qs = (k) => (typeof q[k] === "string" && q[k] ? q[k] : undefined);
                const userIdQ = qs("userId");
                if (userIdQ)
                    return { status: 200, body: { items: [adminUserView(await zh.admin.get(userIdQ))] } };
                const phoneQ = qs("phone");
                if (phoneQ)
                    return { status: 200, body: { items: await listByPhone(phoneQ) } };
                fail("要给 phone 或 userId");
            }
            if (method === "POST" && parts.length === 3 && parts[0] === "accounts" && (parts[2] === "ban" || parts[2] === "unban")) {
                let userId;
                try {
                    // parts.length === 3 已在上面判过,parts[1] 必有;`?? ""` 只为让类型收窄,不会走到
                    userId = decodeURIComponent(parts[1] ?? "");
                }
                catch {
                    fail("路径里的账号 id 编码不对");
                }
                const body = obj(req.body);
                const ctx = { operatorId: operatorOf(who.actor), requestId: requestIdOf(body) };
                if (parts[2] === "ban") {
                    const days = daysOf(body);
                    const reason = reasonOf(body);
                    await mustNotBeAdmin(userId);
                    const r = await zh.admin.ban(userId, { days, reason }, ctx);
                    return { status: 200, body: { ok: true, replayed: r.replayed, user: adminUserView(r.user) } };
                }
                const r = await zh.admin.unban(userId, { reason: reasonOf(body) }, ctx);
                return { status: 200, body: { ok: true, replayed: r.replayed, user: adminUserView(r.user) } };
            }
            return { status: 404, body: { code: "NOT_FOUND", message: "没有这条路由" } };
        }
        catch (err) {
            return toError(err);
        }
    }
    return { enabled, authenticate, dispatch };
}
/** 对外的处理器：错误体统一带 kind（error-kind.ts，公司基础契约 jichu 的 ErrorBody） */
export function createZhanghaoAccountControl(zh, opts) {
    return withErrorKinds(buildZhanghaoAccountControl(zh, opts));
}
