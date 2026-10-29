import { withErrorKinds, withKind } from "./error-kind.js";
export { kindOfStatus } from "./error-kind.js";
import { ZhanghaoError, isZhanghaoError, } from "../types.js";
import { HTTP_STATUS_BY_CODE, ROUTE_BY_KEY, ZHANGHAO_ROUTES, fillPath, } from "./wire.js";
export { HTTP_STATUS_BY_CODE };
/* ────────────────────────────── 投影(Date→ISO) ────────────────────────────── */
function meView(p) {
    return {
        userId: p.userId,
        username: p.username,
        nickname: p.nickname,
        avatarKey: p.avatarKey,
        phoneMasked: p.phoneMasked,
        emailMasked: p.emailMasked,
        role: p.role,
        createdAt: p.createdAt.toISOString(),
    };
}
function publicUserView(u) {
    return { userId: u.userId, displayName: u.displayName, avatarKey: u.avatarKey };
}
function tokenPairView(t) {
    return {
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        sid: t.sid,
        accessExpiresAt: t.accessExpiresAt.toISOString(),
        refreshExpiresAt: t.refreshExpiresAt.toISOString(),
    };
}
export function adminUserView(u) {
    return {
        userId: u.userId,
        username: u.username,
        phone: u.phone,
        email: u.email,
        nickname: u.nickname,
        avatarKey: u.avatarKey,
        role: u.role,
        status: u.status,
        bannedUntil: u.bannedUntil ? u.bannedUntil.toISOString() : null,
        bannedReason: u.bannedReason,
        registerMeta: u.registerMeta,
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
    };
}
function adminActionView(a) {
    return {
        id: a.id,
        requestId: a.requestId,
        operatorId: a.operatorId,
        targetUserId: a.targetUserId,
        action: a.action,
        detail: a.detail,
        createdAt: a.createdAt.toISOString(),
    };
}
function adminResultView(r) {
    return { ok: true, replayed: r.replayed, user: adminUserView(r.user) };
}
function betaCodeView(b) {
    return {
        id: b.id,
        code: b.code,
        note: b.note,
        maxUses: b.maxUses,
        usedCount: b.usedCount,
        enabled: b.enabled,
        expiresAt: b.expiresAt ? b.expiresAt.toISOString() : null,
        createdBy: b.createdBy,
        createdAt: b.createdAt.toISOString(),
        usable: b.usable,
    };
}
/* ────────────────────────────── 轻量校验(不引 zod:包零运行时依赖) ────────────────────────────── */
function fail(message, detail) {
    throw new ZhanghaoError("VALIDATION", message, detail);
}
function asObject(body) {
    if (body === null || body === undefined)
        return {};
    if (typeof body !== "object" || Array.isArray(body))
        fail("请求体必须是 JSON 对象");
    return body;
}
function reqString(body, field) {
    const v = body[field];
    if (typeof v !== "string" || v.trim() === "")
        fail(`缺少字段 ${field}`, { field });
    return v;
}
/** 必填但可为 null 的字段(「解绑」与「没传」是两回事,不能混成一个) */
function reqNullableString(body, field) {
    const v = body[field];
    if (v === null)
        return null;
    if (typeof v !== "string")
        fail(`字段 ${field} 必须是字符串或 null`, { field });
    return v;
}
function optNullableString(body, field) {
    const v = body[field];
    if (v === undefined)
        return undefined;
    if (v === null)
        return null;
    if (typeof v !== "string")
        fail(`字段 ${field} 必须是字符串或 null`, { field });
    return v;
}
function reqNullableInt(body, field) {
    const v = body[field];
    if (v === null)
        return null;
    if (typeof v === "number" && Number.isInteger(v))
        return v;
    if (typeof v === "string" && /^-?\d+$/.test(v))
        return Number(v);
    fail(`字段 ${field} 必须是整数或 null`, { field });
}
function optRole(v, field) {
    if (v === undefined || v === null || v === "")
        return undefined;
    if (v === "user" || v === "admin")
        return v;
    fail(`字段 ${field} 只能是 user / admin`, { field });
}
function optStatus(v, field) {
    if (v === undefined || v === null || v === "")
        return undefined;
    if (v === "active" || v === "banned")
        return v;
    fail(`字段 ${field} 只能是 active / banned`, { field });
}
function optInt(raw, field) {
    if (raw === undefined || raw === "")
        return undefined;
    if (!/^\d+$/.test(raw))
        fail(`查询参数 ${field} 必须是正整数`, { field });
    return Number(raw);
}
function optDate(raw, field) {
    if (raw === undefined || raw === "")
        return undefined;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime()))
        fail(`查询参数 ${field} 不是合法时间`, { field });
    return d;
}
function optBool(body, field) {
    const v = body[field];
    if (v === undefined)
        return undefined;
    if (typeof v !== "boolean")
        fail(`字段 ${field} 必须是布尔`, { field });
    return v;
}
function optNullableInt(body, field) {
    if (body[field] === undefined)
        return undefined;
    return reqNullableInt(body, field);
}
function optNullableDate(body, field) {
    const v = body[field];
    if (v === undefined)
        return undefined;
    if (v === null)
        return null;
    if (typeof v !== "string")
        fail(`字段 ${field} 必须是 ISO 时间串或 null`, { field });
    const d = new Date(v);
    if (Number.isNaN(d.getTime()))
        fail(`字段 ${field} 不是合法时间`, { field });
    return d;
}
function optStringArray(body, field) {
    const v = body[field];
    if (v === undefined || v === null)
        return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
        fail(`字段 ${field} 必须是字符串数组`, { field });
    return v;
}
function optMeta(body, field) {
    const v = body[field];
    if (v === undefined)
        return undefined;
    if (v === null)
        return null;
    if (typeof v !== "object" || Array.isArray(v))
        fail(`字段 ${field} 必须是对象或 null`, { field });
    return v;
}
/* ────────────────────────────── 工厂 ────────────────────────────── */
const DEFAULT_COOKIE_NAMES = { access: "zh_at", refresh: "zh_rt" };
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 34 条路由处理器共享同一组闭包(cookie 配置 / 验证钩子 / 出错口),返回值类型即对外的处理器表;拆成多个工厂会改动导出 .d.ts 且触及登录 / 会话 / 封禁路径,每个处理器本身都很短
function buildZhanghaoHttpHandlers(zh, opts = {}) {
    const cookieNames = { ...DEFAULT_COOKIE_NAMES, ...(opts.cookieNames ?? {}) };
    const cookieBase = { path: opts.cookie?.path ?? "/", sameSite: opts.cookie?.sameSite ?? "Lax", secure: opts.cookie?.secure ?? true };
    function cookiesFor(tokens, now = Date.now()) {
        const sec = (d) => Math.max(0, Math.floor((d.getTime() - now) / 1000));
        return [
            { name: cookieNames.access, value: tokens.accessToken, maxAgeSec: sec(tokens.accessExpiresAt), httpOnly: true, ...cookieBase },
            { name: cookieNames.refresh, value: tokens.refreshToken, maxAgeSec: sec(tokens.refreshExpiresAt), httpOnly: true, ...cookieBase },
        ];
    }
    function clearCookies() {
        return [
            { name: cookieNames.access, value: "", maxAgeSec: 0, httpOnly: true, ...cookieBase },
            { name: cookieNames.refresh, value: "", maxAgeSec: 0, httpOnly: true, ...cookieBase },
        ];
    }
    /** 身份复核:宿主漏挂守卫时这里兜住(auth:"none" 的路由不进这条路) */
    function requireAuth(input, need) {
        const auth = input.auth;
        if (!auth?.userId)
            throw new ZhanghaoError("TOKEN_INVALID", "未登录");
        if (need === "admin" && auth.role !== "admin")
            throw new ZhanghaoError("FORBIDDEN", "需要管理员权限");
        return auth;
    }
    function requireTargetId(input) {
        const id = input.params?.id;
        if (!id)
            fail("缺少路径参数 id", { field: "id" });
        return id;
    }
    /**
     * 后台动作的幂等上下文。**requestId 必填**:前端在动作开始时生成一次、重试复用同一个,
     * 服务端以它为锚(同 requestId 回放不二次生效)。缺了就直接 400 —— 让它可选等于
     * 「网络抖一下就可能重复封号/重复改名」,而重复动作在审计里看不出是第二次。
     */
    function adminCtx(input, auth) {
        const body = asObject(input.body);
        const raw = input.requestId ?? (typeof body.requestId === "string" ? body.requestId : undefined);
        if (!raw?.trim())
            fail("后台动作必须带 requestId(幂等锚)", { field: "requestId" });
        return { operatorId: auth.userId, requestId: raw };
    }
    function refreshTokenOf(input) {
        const body = asObject(input.body);
        const fromBody = typeof body.refreshToken === "string" ? body.refreshToken : "";
        const fromCookie = input.cookies?.[cookieNames.refresh] ?? "";
        const token = fromBody || fromCookie;
        if (!token)
            fail("缺少 refreshToken", { field: "refreshToken" });
        return token;
    }
    /* ── 验证钩子:先人机、再验码、最后才调 zh.*(顺序不能反:验码是一次性消费,先消费再被人机拦等于白烧一条短信) ── */
    function verificationOf(body) {
        const v = body.verification;
        if (v !== null && typeof v === "object" && !Array.isArray(v))
            return v;
        return body;
    }
    function verifyCtx(route, body, input, auth) {
        const ctx = { route, body, verification: verificationOf(body) };
        if (auth)
            ctx.auth = auth;
        if (input.meta)
            ctx.meta = input.meta;
        return ctx;
    }
    async function runCaptcha(ctx) {
        if (opts.verify?.captcha)
            await opts.verify.captcha(ctx);
    }
    async function runCode(ctx, channel, target, purpose) {
        if (!opts.verify?.code)
            return;
        if (target === null || target === undefined || target === "")
            return; // 没带 / 解绑:没有码可验
        await opts.verify.code({ ...ctx, channel, target, purpose });
    }
    /** 两段式的第一段(见 VerificationHooks.peekCode)。没有 peekCode 时返回 false,调用方退回老顺序。 */
    const twoPhase = () => Boolean(opts.verify?.code && opts.verify?.peekCode);
    async function peekCode(ctx, channel, target, purpose) {
        if (!opts.verify?.peekCode)
            return;
        if (target === null || target === undefined || target === "")
            return;
        await opts.verify.peekCode({ ...ctx, channel, target, purpose });
    }
    const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
    function fingerprintOf(ctx, input) {
        const meta = ctx.body.registerMeta;
        const candidates = [
            ctx.verification.fingerprint,
            meta !== null && typeof meta === "object" ? meta.fingerprint : undefined,
            input.meta?.deviceId,
            input.headers?.["x-device-fingerprint"],
        ];
        for (const c of candidates)
            if (typeof c === "string" && FINGERPRINT_RE.test(c))
                return c;
        return null;
    }
    /** 注册管控裁决:钩子缺省用 `registration.verifyRegister`;两者都没有 = 不管控 */
    async function runRegister(ctx, input) {
        const hook = opts.verify?.register ?? opts.registration?.verifyRegister;
        if (!hook)
            return {};
        const rawCode = ctx.body.betaCode;
        const betaCode = typeof rawCode === "string" && rawCode.trim() ? rawCode.trim().toUpperCase() : null;
        const decision = await hook({ ...ctx, route: "register", fingerprint: fingerprintOf(ctx, input), betaCode });
        return decision ?? {};
    }
    function requireRegistration() {
        return opts.registration ?? null;
    }
    const NO_REGISTRATION = { status: 404, body: { code: "NOT_FOUND", message: "未启用注册管控(createZhanghaoHttpHandlers 没传 registration)" } };
    /** 统一出错口:ZhanghaoError → 映射表;其它 → 500 且**不外泄任何内部信息** */
    function toError(err, routeKey) {
        // 不用 instanceof:宿主 store/钩子抛的 ZhanghaoError 可能来自同一个包的另一份加载实例(见 isZhanghaoError)
        if (isZhanghaoError(err) && HTTP_STATUS_BY_CODE[err.code] !== undefined) {
            const body = { code: err.code, message: err.message };
            if (err.detail)
                body.detail = err.detail;
            return { status: HTTP_STATUS_BY_CODE[err.code], body };
        }
        opts.onInternalError?.(err, routeKey);
        return { status: 500, body: { code: "INTERNAL", message: "服务暂时不可用" } };
    }
    function guard(routeKey, fn) {
        return fn().catch((err) => toError(err, routeKey));
    }
    async function authResult(user, tokens) {
        // 掩码规则只有一处(service.me),这里不复制一份 —— 复制出来的第二份迟早与第一份不一致
        const profile = await zh.me(user.userId);
        return { status: 200, body: { user: meView(profile), tokens: tokenPairView(tokens) }, setCookies: cookiesFor(tokens) };
    }
    const handlers = {
        /* ────────────── 玩家:注册 / 登录 / 会话 ────────────── */
        register(input) {
            return guard("register", async () => {
                const body = asObject(input.body);
                const phone = optNullableString(body, "phone") ?? null;
                const email = optNullableString(body, "email") ?? null;
                const vctx = verifyCtx("register", body, input);
                await runCaptcha(vctx);
                /* 两段式(有 peekCode 时):只读校验 → 注册管控 + 占用/长度预检 → 真正消费 → 建号。
                   任何一道可预见的拒绝都发生在消费之前,用户的码还在,改完直接再提交即可。 */
                const split = twoPhase();
                if (split) {
                    await peekCode(vctx, "phone", phone, "register");
                    await peekCode(vctx, "email", email, "register");
                }
                else {
                    await runCode(vctx, "phone", phone, "register");
                    await runCode(vctx, "email", email, "register");
                }
                // 注册管控(总开关 / 名额 / 内测码 / 一机 N 号)在人机与验码之后裁决;它要占名额扣码的那部分进 beforeCreate 同事务
                const decision = await runRegister(vctx, input);
                if (split) {
                    await zh.checkRegister({ username: reqString(body, "username"), password: reqString(body, "password"), phone, email });
                    await runCode(vctx, "phone", phone, "register");
                    await runCode(vctx, "email", email, "register");
                }
                const bodyMeta = optMeta(body, "registerMeta") ?? null;
                const extra = decision.registerMeta && Object.keys(decision.registerMeta).length > 0 ? decision.registerMeta : null;
                // 两边都没东西就保持 null(老宿主行为逐字不变),不把 null 悄悄变成 {}
                const registerMeta = bodyMeta || extra ? { ...(bodyMeta ?? {}), ...(extra ?? {}) } : null;
                /* role **刻意不从 body 读**:客户端能自选角色就是一键提权。需要建管理员走后台/脚本。 */
                const base = {
                    username: reqString(body, "username"),
                    password: reqString(body, "password"),
                    phone,
                    email,
                    nickname: optNullableString(body, "nickname") ?? null,
                    registerMeta,
                    meta: input.meta,
                };
                if (decision.beforeCreate)
                    base.beforeCreate = decision.beforeCreate;
                if (opts.afterCreate)
                    base.afterCreate = opts.afterCreate;
                // 宿主给了事务边界:占名额 / 扣码 / 建号 / afterCreate 同生共死;没给就各自提交
                const { user, tokens } = opts.transaction ? await opts.transaction((tx) => zh.register({ ...base, tx })) : await zh.register(base);
                return authResult(user, tokens);
            });
        },
        login(input) {
            return guard("login", async () => {
                const body = asObject(input.body);
                await runCaptcha(verifyCtx("login", body, input)); // 登录只验人机,不验码
                const { user, tokens } = await zh.login({
                    identifier: reqString(body, "identifier"),
                    password: reqString(body, "password"),
                    requireRole: opts.requireRole ?? optRole(body.requireRole, "requireRole"),
                    meta: input.meta,
                });
                return authResult(user, tokens);
            });
        },
        refresh(input) {
            return guard("refresh", async () => {
                const { user, tokens } = await zh.refresh(refreshTokenOf(input), input.meta);
                return authResult(user, tokens);
            });
        },
        logout(input) {
            return guard("logout", async () => {
                // 只吊销当前这一台。生产上栽过「登出把别的设备一起踢下线」,那不是安全是打扰
                await zh.logout(refreshTokenOf(input));
                return { status: 200, body: { ok: true }, setCookies: clearCookies() };
            });
        },
        resetPassword(input) {
            return guard("resetPassword", async () => {
                const body = asObject(input.body);
                const ident = asObject(body.identifier);
                const kind = ident.kind;
                if (kind !== "phone" && kind !== "email" && kind !== "userId")
                    fail("identifier.kind 只能是 phone / email / userId", { field: "identifier.kind" });
                const value = reqString(ident, "value");
                const newPassword = reqString(body, "newPassword");
                const vctx = verifyCtx("resetPassword", body, input);
                await runCaptcha(vctx);
                if (kind !== "userId" && twoPhase()) {
                    /* 只读校验 → 长度闸门 + 查号 → 真正消费 → 改密。
                       查号必须在(只读)验码之后:排在前面就是零成本的号码枚举器。
                       号不存在 / 密码太短时码还在 —— 改完再提交不会看到「验证码已过期」。 */
                    await peekCode(vctx, kind, value, "reset");
                    await zh.checkResetPassword({ kind, value }, newPassword);
                    await runCode(vctx, kind, value, "reset");
                }
                else if (kind !== "userId") {
                    await runCode(vctx, kind, value, "reset");
                }
                await zh.resetPassword({ kind, value }, newPassword);
                /* 回执刻意**不带 userId**:找回密码入口是匿名的,回一个 userId 就等于「这个号存在」的预言机 */
                return { status: 200, body: { ok: true } };
            });
        },
        /* ────────────── 玩家:本人 ────────────── */
        me(input) {
            return guard("me", async () => {
                const auth = requireAuth(input, "user");
                return { status: 200, body: meView(await zh.me(auth.userId)) };
            });
        },
        updateProfile(input) {
            return guard("updateProfile", async () => {
                const auth = requireAuth(input, "user");
                const body = asObject(input.body);
                const patch = {};
                const nickname = optNullableString(body, "nickname");
                if (nickname !== undefined)
                    patch.nickname = nickname;
                const avatarKey = optNullableString(body, "avatarKey");
                if (avatarKey !== undefined)
                    patch.avatarKey = avatarKey;
                if (Object.keys(patch).length === 0)
                    fail("至少要改一个字段(nickname / avatarKey)");
                return { status: 200, body: meView(await zh.updateProfile(auth.userId, patch)) };
            });
        },
        changePassword(input) {
            return guard("changePassword", async () => {
                const auth = requireAuth(input, "user");
                const body = asObject(input.body);
                await zh.changePassword(auth.userId, reqString(body, "oldPassword"), reqString(body, "newPassword"));
                // 改密会吊销全部会话(含本台),客户端应清 cookie 并跳登录
                return { status: 200, body: { ok: true }, setCookies: clearCookies() };
            });
        },
        bindPhone(input) {
            return guard("bindPhone", async () => {
                const auth = requireAuth(input, "user");
                const body = asObject(input.body);
                const phone = reqNullableString(body, "phone");
                await runCode(verifyCtx("bindPhone", body, input, auth), "phone", phone, "bind"); // null(解绑)不验
                return { status: 200, body: meView(await zh.bindPhone(auth.userId, phone)) };
            });
        },
        bindEmail(input) {
            return guard("bindEmail", async () => {
                const auth = requireAuth(input, "user");
                const body = asObject(input.body);
                const email = reqNullableString(body, "email");
                await runCode(verifyCtx("bindEmail", body, input, auth), "email", email, "bind");
                return { status: 200, body: meView(await zh.bindEmail(auth.userId, email)) };
            });
        },
        /* ────────────── 公开投影 ────────────── */
        publicUser(input) {
            return guard("publicUser", async () => {
                const id = requireTargetId(input);
                const u = await zh.publicUser(id);
                if (!u)
                    return { status: 404, body: { code: "USER_NOT_FOUND", message: "用户不存在" } };
                return { status: 200, body: publicUserView(u) };
            });
        },
        /* ────────────── 后台 ────────────── */
        adminSearch(input) {
            return guard("adminSearch", async () => {
                requireAuth(input, "admin");
                const q = input.query ?? {};
                const rows = await zh.admin.search({
                    query: q.query || undefined,
                    role: optRole(q.role, "role"),
                    status: optStatus(q.status, "status"),
                    createdFrom: optDate(q.createdFrom, "createdFrom"),
                    createdTo: optDate(q.createdTo, "createdTo"),
                    beforeUserId: q.beforeUserId || undefined,
                    limit: optInt(q.limit, "limit"),
                });
                return { status: 200, body: { items: rows.map(adminUserView) } };
            });
        },
        adminGet(input) {
            return guard("adminGet", async () => {
                requireAuth(input, "admin");
                return { status: 200, body: adminUserView(await zh.admin.get(requireTargetId(input))) };
            });
        },
        adminBan(input) {
            return guard("adminBan", async () => {
                const auth = requireAuth(input, "admin");
                const id = requireTargetId(input);
                const body = asObject(input.body);
                const r = await zh.admin.ban(id, { days: reqNullableInt(body, "days"), reason: reqString(body, "reason") }, adminCtx(input, auth));
                return { status: 200, body: adminResultView(r) };
            });
        },
        adminUnban(input) {
            return guard("adminUnban", async () => {
                const auth = requireAuth(input, "admin");
                const id = requireTargetId(input);
                const r = await zh.admin.unban(id, { reason: reqString(asObject(input.body), "reason") }, adminCtx(input, auth));
                return { status: 200, body: adminResultView(r) };
            });
        },
        adminSetNickname(input) {
            return guard("adminSetNickname", async () => {
                const auth = requireAuth(input, "admin");
                const id = requireTargetId(input);
                const r = await zh.admin.setNickname(id, reqNullableString(asObject(input.body), "nickname"), adminCtx(input, auth));
                return { status: 200, body: adminResultView(r) };
            });
        },
        adminSetUsername(input) {
            return guard("adminSetUsername", async () => {
                const auth = requireAuth(input, "admin");
                const id = requireTargetId(input);
                const r = await zh.admin.setUsername(id, reqString(asObject(input.body), "username"), adminCtx(input, auth));
                return { status: 200, body: adminResultView(r) };
            });
        },
        adminSetPhone(input) {
            return guard("adminSetPhone", async () => {
                const auth = requireAuth(input, "admin");
                const id = requireTargetId(input);
                const body = asObject(input.body);
                const r = await zh.admin.setPhone(id, reqNullableString(body, "phone"), { reason: reqString(body, "reason") }, adminCtx(input, auth));
                return { status: 200, body: adminResultView(r) };
            });
        },
        adminSetEmail(input) {
            return guard("adminSetEmail", async () => {
                const auth = requireAuth(input, "admin");
                const id = requireTargetId(input);
                const body = asObject(input.body);
                const r = await zh.admin.setEmail(id, reqNullableString(body, "email"), { reason: reqString(body, "reason") }, adminCtx(input, auth));
                return { status: 200, body: adminResultView(r) };
            });
        },
        adminResetPassword(input) {
            return guard("adminResetPassword", async () => {
                const auth = requireAuth(input, "admin");
                const id = requireTargetId(input);
                const r = await zh.admin.resetPassword(id, reqString(asObject(input.body), "password"), adminCtx(input, auth));
                return { status: 200, body: adminResultView(r) };
            });
        },
        adminRevokeSessions(input) {
            return guard("adminRevokeSessions", async () => {
                const auth = requireAuth(input, "admin");
                const id = requireTargetId(input);
                const r = await zh.admin.revokeSessions(id, { reason: reqString(asObject(input.body), "reason") }, adminCtx(input, auth));
                return { status: 200, body: adminResultView(r) };
            });
        },
        adminResetLoginLock(input) {
            return guard("adminResetLoginLock", async () => {
                const auth = requireAuth(input, "admin");
                const id = requireTargetId(input);
                const reason = reqString(asObject(input.body), "reason");
                const r = await zh.admin.resetLoginLock(id, { reason }, adminCtx(input, auth));
                return { status: 200, body: adminResultView(r) };
            });
        },
        adminLoginLock(input) {
            return guard("adminLoginLock", async () => {
                requireAuth(input, "admin");
                const r = await zh.admin.loginLock(requireTargetId(input));
                return { status: 200, body: { lockedForSec: r.lockedForSec, failCount: r.failCount } };
            });
        },
        adminListActions(input) {
            return guard("adminListActions", async () => {
                requireAuth(input, "admin");
                const id = requireTargetId(input);
                const q = input.query ?? {};
                const rows = await zh.admin.listActions(id, { beforeId: q.beforeId || undefined, limit: optInt(q.limit, "limit") });
                return { status: 200, body: { items: rows.map(adminActionView) } };
            });
        },
        /* ────────────── 后台:注册管控(要 opts.registration,否则 404) ────────────── */
        adminRegistration(input) {
            return guard("adminRegistration", async () => {
                requireAuth(input, "admin");
                const reg = requireRegistration();
                if (!reg)
                    return NO_REGISTRATION;
                const st = await reg.status();
                return {
                    status: 200,
                    body: {
                        policy: st.policy,
                        dayKey: st.dayKey,
                        resetAt: st.resetAt.toISOString(),
                        dailyUsed: st.dailyUsed,
                        dailyRemaining: st.dailyRemaining,
                        storeSupports: st.storeSupports,
                    },
                };
            });
        },
        adminListBetaCodes(input) {
            return guard("adminListBetaCodes", async () => {
                requireAuth(input, "admin");
                const reg = requireRegistration();
                if (!reg)
                    return NO_REGISTRATION;
                const q = input.query ?? {};
                const status = q.status;
                if (status !== undefined && status !== "" && status !== "all" && status !== "usable" && status !== "unusable")
                    fail("查询参数 status 只能是 all / usable / unusable", { field: "status" });
                const limit = optInt(q.limit, "limit");
                const rows = await reg.admin.listBetaCodes({
                    ...(q.query ? { query: q.query } : {}),
                    ...(status && status !== "all" ? { status: status } : {}),
                    ...(q.beforeId ? { beforeId: q.beforeId } : {}),
                    ...(limit !== undefined ? { limit } : {}),
                });
                return { status: 200, body: { items: rows.map(betaCodeView) } };
            });
        },
        adminCreateBetaCodes(input) {
            return guard("adminCreateBetaCodes", async () => {
                const auth = requireAuth(input, "admin");
                const reg = requireRegistration();
                if (!reg)
                    return NO_REGISTRATION;
                const body = asObject(input.body);
                const ctx = adminCtx(input, auth);
                const codes = optStringArray(body, "codes");
                const count = optNullableInt(body, "count");
                const prefix = optNullableString(body, "prefix");
                const note = optNullableString(body, "note");
                const maxUses = optNullableInt(body, "maxUses");
                const expiresAt = optNullableDate(body, "expiresAt");
                const r = await reg.admin.createBetaCodes({
                    ...(codes ? { codes } : {}),
                    ...(count !== undefined && count !== null ? { count } : {}),
                    ...(prefix ? { prefix } : {}),
                    ...(note ? { note } : {}),
                    ...(maxUses !== undefined ? { maxUses } : {}),
                    ...(expiresAt !== undefined ? { expiresAt } : {}),
                }, ctx);
                return { status: 200, body: { created: r.created.map(betaCodeView), existing: r.existing } };
            });
        },
        adminUpdateBetaCode(input) {
            return guard("adminUpdateBetaCode", async () => {
                const auth = requireAuth(input, "admin");
                const reg = requireRegistration();
                if (!reg)
                    return NO_REGISTRATION;
                const id = requireTargetId(input);
                const body = asObject(input.body);
                const ctx = adminCtx(input, auth);
                const patch = {};
                const note = optNullableString(body, "note");
                if (note !== undefined)
                    patch.note = note ?? "";
                const maxUses = optNullableInt(body, "maxUses");
                if (maxUses !== undefined)
                    patch.maxUses = maxUses;
                const enabled = optBool(body, "enabled");
                if (enabled !== undefined)
                    patch.enabled = enabled;
                const expiresAt = optNullableDate(body, "expiresAt");
                if (expiresAt !== undefined)
                    patch.expiresAt = expiresAt;
                if (Object.keys(patch).length === 0)
                    fail("至少要改一个字段(note / maxUses / enabled / expiresAt)");
                const row = await reg.admin.updateBetaCode(id, patch, ctx);
                if (!row)
                    return { status: 404, body: { code: "NOT_FOUND", message: "内测码不存在" } };
                return { status: 200, body: betaCodeView(row) };
            });
        },
    };
    return handlers;
}
function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(";")) {
        const i = part.indexOf("=");
        if (i <= 0)
            continue;
        const k = part.slice(0, i).trim();
        if (k)
            out[k] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
}
function serializeCookie(c) {
    const bits = [`${c.name}=${encodeURIComponent(c.value)}`, `Path=${c.path}`, `Max-Age=${c.maxAgeSec}`, `SameSite=${c.sameSite}`];
    if (c.httpOnly)
        bits.push("HttpOnly");
    if (c.secure)
        bits.push("Secure");
    return bits.join("; ");
}
/** `/admin/users/:id/ban` 编译成匹配器(段数固定,`:x` 段抓成参数) */
function compile(path) {
    const segs = path.split("/").filter(Boolean);
    return { segs, names: segs.map((s) => (s.startsWith(":") ? s.slice(1) : null)) };
}
const COMPILED = ZHANGHAO_ROUTES.map((r) => ({ route: r, ...compile(r.path) }));
/**
 * 把处理器绑成一个 `(Request) => Response`,任何支持 Fetch API 的框架(Next.js Route Handler、
 * Hono、Bun、Deno、Cloudflare Workers)都能直接挂。宿主只需提供 `resolveAuth`。
 *
 * 路由匹配走 ZHANGHAO_ROUTES,**不再写第二份路径表** —— 这正是 wire 存在的理由。
 */
export function bindToFetch(handlers, options = {}) {
    const basePath = (options.basePath ?? "").replace(/\/+$/, "");
    return async function handle(req) {
        const url = new URL(req.url);
        let pathname = url.pathname;
        if (basePath && pathname.startsWith(basePath))
            pathname = pathname.slice(basePath.length);
        const parts = pathname.split("/").filter(Boolean);
        let matched = null;
        let pathExists = false;
        for (const c of COMPILED) {
            if (c.segs.length !== parts.length)
                continue;
            const params = {};
            let ok = true;
            for (let i = 0; i < c.segs.length; i++) {
                const name = c.names[i];
                const seg = parts[i];
                if (name)
                    params[name] = decodeURIComponent(seg);
                else if (c.segs[i] !== seg) {
                    ok = false;
                    break;
                }
            }
            if (!ok)
                continue;
            pathExists = true;
            if (c.route.method !== req.method)
                continue;
            matched = { key: c.route.key, params: { id: params.id } };
            break;
        }
        if (!matched) {
            const status = pathExists ? 405 : 404;
            const body = pathExists ? { code: "METHOD_NOT_ALLOWED", message: "方法不允许" } : { code: "NOT_FOUND", message: "no such route" };
            return json(status, body);
        }
        let body;
        if (req.method !== "GET") {
            try {
                const text = await req.text();
                body = text ? JSON.parse(text) : undefined;
            }
            catch {
                return json(400, { code: "VALIDATION", message: "请求体不是合法 JSON" });
            }
        }
        let auth = null;
        try {
            auth = (await options.resolveAuth?.(req)) ?? null;
        }
        catch {
            // 验签失败 = 未登录;auth:"user" 的路由会在处理器里返回 401
            auth = null;
        }
        const query = {};
        url.searchParams.forEach((v, k) => {
            query[k] = v;
        });
        const reqHeaders = {};
        req.headers.forEach((v, k) => {
            reqHeaders[k.toLowerCase()] = v;
        });
        const result = await handlers[matched.key]({
            auth,
            params: matched.params,
            query,
            body,
            cookies: parseCookies(req.headers.get("cookie")),
            headers: reqHeaders,
            requestId: req.headers.get("x-request-id") ?? undefined,
            meta: {
                ip: options.resolveIp?.(req) ?? null,
                ua: req.headers.get("user-agent"),
                deviceId: req.headers.get("x-device-fingerprint"),
            },
        });
        const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
        for (const c of result.setCookies ?? [])
            headers.append("set-cookie", serializeCookie(c));
        return new Response(result.body === null ? "" : JSON.stringify(result.body), { status: result.status, headers });
    };
}
function json(status, body) {
    return new Response(JSON.stringify(withKind({ status, body }).body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
export { fillPath, ROUTE_BY_KEY };
/** 对外的处理器：错误体统一带 kind（error-kind.ts，公司基础契约 jichu 的 ErrorBody） */
export function createZhanghaoHttpHandlers(zh, opts = {}) {
    return withErrorKinds(buildZhanghaoHttpHandlers(zh, opts));
}
