/**
 * zhanghao 领域内核:注册 / 登录 / 会话 / 本人资料 / 公开投影 / 后台用户管理的全部业务规则。
 *
 * 包管什么、不管什么:
 *   - 标识符归一化、密码闸门与哈希、唯一性冲突翻译、token 签发与轮换、会话吊销、
 *     防枚举、后台幂等审计 —— **包**。
 *   - 谁有权调后台接口、短信/邮箱验证码、钱包与注册礼包、通知 —— **宿主**(afterCreate / onEvent)。
 *
 * 几条容易写错、写错了还不报错的地方,都在下面对应位置写了原因:
 *   1. 唯一性只信 store 的约束返回值,不先查再写(并发注册会放进两个同名号)。
 *   2. 「不存在」与「密码错」必须走同一条出口(同错误码同文案),且两条路都要 record 失败 ——
 *      否则状态码/耗时差异本身就是账号枚举预言机。
 *   3. KV 写在 PG 写成功之后:token/会话不进宿主事务(事务回滚不会回滚 Redis)。
 *   4. `auth:sessions:{userId}` 是集合不是单值,单值只记得最后登录那一台。
 */
import { randomUUID } from "node:crypto";
import { classifyIdentifier, displayNameOf, loginLookupOrder, maskEmail, NICKNAME_LOGIN_CANDIDATE_LIMIT, pickUniqueNicknameMatch, maskPhone, normalizeEmail, normalizePhone, normalizeUsername, parseSearchQuery } from "./identifier.js";
import { keys as buildKeys } from "./keys.js";
import { assertPassword, createScryptHasher } from "./password.js";
import { explainUsername } from "./username.js";
import { explainNickname, maskPhonesInText } from "./nickname.js";
import { signJwt, verifyJwt } from "./tokens.js";
import { ZhanghaoError, } from "./types.js";
const DEFAULT_ACCESS_TTL_SEC = 900;
const DEFAULT_REFRESH_TTL_SEC = 14 * 24 * 3600;
const DEFAULT_KICKED_MESSAGE = "你的账号已在其他设备登录";
const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 200;
/** publicUsers 单次打库的 id 上限(1.18.0):超过就分批,不拒绝 —— bridge 给兄弟包做投影时可能一次传很多 */
const PUBLIC_USERS_BATCH = 500;
/** 后台动作占坑超过这么久效果仍不可见 → 视为「执行中崩了」(REQUEST_IN_PROGRESS 带 stale:true) */
const CLAIM_STALE_MS = 60_000;
/**
 * 构造时已校验过的可选 store 方法,调用时万一又不在了:与原来的 `store.x!()` 一样抛 TypeError
 * (登录被拒、走 500),不换成别的错误码,更不会被当成「查不到」吞掉。
 */
function missingStoreMethod(name) {
    throw new TypeError(`store.${name} is not a function`);
}
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: 账号核心服务(注册 / 登录 / 续签 / 封禁 / 后台动作)共享同一组闭包状态(密钥、TTL、哈希器、登录防护、单设备会话);拆分会触及登录 / 会话 / 封禁路径,内部已按「校验 / 会话 / 投影 / 幂等」分成短的内部函数
export function createZhanghao(opts) {
    const { store, kv } = opts;
    const K = buildKeys(opts.keyPrefix);
    const secrets = Array.isArray(opts.secret) ? opts.secret : [opts.secret];
    const signSecret = secrets[0];
    if (!signSecret)
        throw new ZhanghaoError("VALIDATION", "secret 不能为空");
    const cfg = opts.config ?? {};
    const accessTtl = cfg.accessTtlSec ?? DEFAULT_ACCESS_TTL_SEC;
    const refreshTtl = cfg.refreshTtlSec ?? DEFAULT_REFRESH_TTL_SEC;
    const pwdPolicy = cfg.password ?? {};
    const usernameRule = cfg.username ?? {};
    const nicknameLogin = cfg.login?.nickname === true;
    const nicknameRule = cfg.nickname === false ? null : (cfg.nickname ?? {});
    const fallbackName = cfg.fallbackDisplayName ?? ((id) => `玩家${id}`);
    const kickedMessage = cfg.kickedMessage ?? DEFAULT_KICKED_MESSAGE;
    // 开了昵称登录而 store 查不了昵称:启动就失败(fail closed)。放到登录时才发现 = 线上某个玩家输昵称时 500,
    // 或者更糟 —— 被当成「查不到」静默吞掉,宿主以为开了其实没开
    if (nicknameLogin && typeof store.findManyForLoginByNickname !== "function") {
        throw new ZhanghaoError("STORE_UNAVAILABLE", "config.login.nickname 开了,但 store 没实现 findManyForLoginByNickname(fail closed)", {
            capability: "findManyForLoginByNickname",
        });
    }
    const hasher = opts.hasher ?? createScryptHasher();
    const now = opts.clock ?? (() => new Date());
    const guard = opts.loginGuard;
    const single = opts.singleSession;
    const warn = (message, extra) => {
        // biome-ignore lint/suspicious/noConsole: 宿主没给 onWarn 时的默认告警出口
        (opts.onWarn ?? ((m, x) => console.warn(`[zhanghao] ${m}`, x ?? "")))(message, extra);
    };
    /** 事件是尽力而为:落库为准,通知失败不能把主流程带崩 */
    const emit = (event) => {
        if (!opts.onEvent)
            return;
        try {
            opts.onEvent(event);
        }
        catch {
            /* 刻意吞掉 */
        }
    };
    /* ────────────────────────── 内部:校验 ────────────────────────── */
    function requireUsername(raw) {
        const name = normalizeUsername(raw);
        // 规则与文案单一裁决点 src/username.ts(前端 react 预检用的是同一个函数);宿主给了自定义 pattern 就只按它判
        const why = explainUsername(name, usernameRule);
        if (why || name === null)
            throw new ZhanghaoError("VALIDATION", why ?? "请填写用户名");
        return name;
    }
    /** 昵称规范(src/nickname.ts,前端预检同一函数);current = 库里现值,没改就不判 */
    function checkNickname(next, current) {
        if (!nicknameRule || next === null || next === (current ?? null))
            return;
        const why = explainNickname(next, nicknameRule);
        if (why)
            throw new ZhanghaoError("VALIDATION", why);
    }
    function conflictError(field) {
        if (field === "username")
            return new ZhanghaoError("USERNAME_TAKEN", "该用户名已被使用");
        if (field === "phone")
            return new ZhanghaoError("PHONE_TAKEN", "该手机号已被使用");
        return new ZhanghaoError("EMAIL_TAKEN", "该邮箱已被使用");
    }
    /** 封禁是否仍然生效:bannedUntil 为 null = 永久 */
    function isBanned(user) {
        if (user.status !== "banned")
            return false;
        if (!user.bannedUntil)
            return true;
        return user.bannedUntil.getTime() > now().getTime();
    }
    /* ────────────────────────── 内部:会话 ────────────────────────── */
    async function issueTokens(user, sid, meta) {
        const at = now();
        const accessJti = randomUUID();
        const refreshJti = randomUUID();
        const accessToken = signJwt({ sub: user.userId, role: user.role, sid, jti: accessJti, typ: "access" }, signSecret, { expSec: accessTtl, now: at });
        const refreshToken = signJwt({ sub: user.userId, jti: refreshJti, sid, typ: "refresh" }, signSecret, {
            expSec: refreshTtl,
            now: at,
        });
        const exp = Math.floor(at.getTime() / 1000) + refreshTtl;
        const record = { userId: user.userId, sid, status: "active", exp };
        // KV 在 PG 之后写:事务回滚不会回滚 Redis,先写会留下指向不存在账号的会话
        await kv.set(K.refresh(refreshJti), JSON.stringify(record), refreshTtl);
        await kv.sadd(K.sessions(user.userId), refreshJti);
        await kv.expire(K.sessions(user.userId), refreshTtl);
        void meta; // meta 只进事件与 singleSession,不落 token
        return {
            accessToken,
            refreshToken,
            sid,
            accessExpiresAt: new Date(at.getTime() + accessTtl * 1000),
            refreshExpiresAt: new Date(at.getTime() + refreshTtl * 1000),
        };
    }
    async function revokeAllSessions(userId, reason) {
        const jtis = await kv.smembers(K.sessions(userId));
        for (const jti of jtis)
            await kv.del(K.refresh(jti));
        await kv.del(K.sessions(userId));
        if (single)
            await single.kickAll(userId, kickedMessage);
        emit({ type: "sessions_revoked", userId, reason });
    }
    /* ────────────────────────── 内部:投影 ────────────────────────── */
    function toMe(user) {
        return {
            userId: user.userId,
            username: user.username,
            nickname: user.nickname,
            avatarKey: user.avatarKey,
            phoneMasked: maskPhone(user.phone),
            emailMasked: maskEmail(user.email),
            role: user.role,
            createdAt: user.createdAt,
        };
    }
    /** 公开投影:结构上拿不到 username / phone / email */
    function toPublic(user) {
        return {
            userId: user.userId,
            displayName: displayNameOf(user, fallbackName),
            avatarKey: user.avatarKey,
        };
    }
    async function mustGet(userId) {
        const user = await store.findById(userId);
        if (!user)
            throw new ZhanghaoError("USER_NOT_FOUND", "账号不存在");
        return user;
    }
    /* ────────────────────────── 内部:后台幂等 ────────────────────────── */
    /**
     * 后台动作的统一外壳:requestId 是幂等锚。
     * 1.18 起顺序是「占坑(insertAdminActionIfAbsent)→ 赢家才 mutate → 失败退坑(releaseAdminAction)」:
     * 原来的「先查回放 → mutate → 记审计」在同 requestId 并发时两个请求都查不到、都执行(ban 还各吊销一次会话),
     * 而审计插入抛错时改动留下、审计没有。回放时一个字节都不再改;
     * 同 requestId 被用在别的目标/动作上要当成调用方写错(REQUEST_ID_CONFLICT),不能默默放过。
     * 宿主自己实现的 store 没有 releaseAdminAction → 退回旧顺序(占了坑退不回去,改失败后重试会被误当回放)。
     */
    async function runIdempotent(ctx, targetUserId, action, detail, mutate, effect) {
        if (!ctx?.requestId)
            throw new ZhanghaoError("VALIDATION", "缺少 requestId");
        const requestId = ctx.requestId;
        const replay = async (prior) => {
            if (prior && (prior.targetUserId !== targetUserId || prior.action !== action)) {
                throw new ZhanghaoError("REQUEST_ID_CONFLICT", "该请求编号已用于其他操作", {
                    requestId,
                    action: prior.action,
                    targetUserId: prior.targetUserId,
                });
            }
            return { ok: true, replayed: true, user: await mustGet(targetUserId) };
        };
        const release = store.releaseAdminAction?.bind(store);
        if (!release)
            return runIdempotentLegacy(ctx, targetUserId, action, detail, mutate, replay);
        const user = await mustGet(targetUserId);
        // 审计要记「改前 → 改后」:运营查台账时最想知道的是原来是什么;detail 在改之前就算好
        const record = { requestId, operatorId: ctx.operatorId, targetUserId, action, detail: typeof detail === "function" ? detail(user) : detail };
        const rec = await store.insertAdminActionIfAbsent(record);
        // 没占到坑 = 这个 requestId 已执行过或正被并发的另一个请求执行:核对效果再决定回放还是「处理中」,不再改
        if (!rec)
            return replayClaimed(requestId, targetUserId, effect, replay);
        try {
            await mutate(user);
        }
        catch (err) {
            // 没生效的动作不留审计,也别占着 requestId —— 否则调用方修正后重试会被当成回放
            await release(requestId).catch((e) => warn(`后台动作退坑失败(requestId=${requestId}):该 requestId 会一直回 REQUEST_IN_PROGRESS,需人工删审计行或换 requestId`, { requestId, error: String(e) }));
            throw err;
        }
        emit({ type: "admin_action", action: rec });
        return { ok: true, replayed: false, user: await mustGet(targetUserId) };
    }
    /**
     * 占坑失败后的回放:审计行在、但效果不一定在(赢家还在改 / 改失败正在退坑 / 进程崩在中间)。
     * 能核对效果的动作(effect)看目标用户当前状态:看得到才回 replayed:true,看不到回 REQUEST_IN_PROGRESS(可重试);
     * 不能核对的(重置密码 / 下线 / 解锁)在占坑 60 秒内回 REQUEST_IN_PROGRESS,之后当已完成。不自动重跑。
     */
    async function replayClaimed(requestId, targetUserId, effect, replay) {
        const prior = await store.findAdminActionByRequestId(requestId);
        if (prior)
            await replay(prior); // 只为换目标/动作时抛 REQUEST_ID_CONFLICT
        const stale = !!prior && now().getTime() - prior.createdAt.getTime() > CLAIM_STALE_MS;
        const user = await mustGet(targetUserId);
        const done = prior !== null && (effect ? effect(user) : stale);
        if (done)
            return { ok: true, replayed: true, user };
        throw new ZhanghaoError("REQUEST_IN_PROGRESS", "该操作正在处理中,请稍后刷新查看", { requestId, stale });
    }
    /** 老 store(没实现 releaseAdminAction)走的旧顺序:先查回放 → mutate → 记审计 */
    async function runIdempotentLegacy(ctx, targetUserId, action, detail, mutate, replay) {
        const prior = await store.findAdminActionByRequestId(ctx.requestId);
        if (prior)
            return replay(prior);
        const user = await mustGet(targetUserId);
        const detailText = typeof detail === "function" ? detail(user) : detail;
        await mutate(user);
        const rec = await store.insertAdminActionIfAbsent({ requestId: ctx.requestId, operatorId: ctx.operatorId, targetUserId, action, detail: detailText });
        // 返 null = 并发的同 requestId 已经落过一条:当回放处理,不再对外声称「本次生效」
        if (!rec)
            return replay(null);
        emit({ type: "admin_action", action: rec });
        return { ok: true, replayed: false, user: await mustGet(targetUserId) };
    }
    /** 后台改唯一标识的共同部分:归一化 → 只信约束 → 落审计 */
    async function setIdentifier(userId, field, value, action, detail, ctx, afterOk) {
        return runIdempotent(ctx, userId, action, detail, async () => {
            const ok = await store.updateIdentifierIfFree(userId, field, value);
            if (!ok)
                throw conflictError(field);
            if (afterOk)
                await afterOk();
        }, (u) => (u[field] ?? null)?.toLowerCase() === value?.toLowerCase());
    }
    /* ────────────────────────── 对外 ────────────────────────── */
    /** 找回密码的校验部分(长度闸门 + 查号)。`checkResetPassword` 与 `resetPassword` 共用,保证两边判据与错误逐字一致。 */
    async function resolveResetTarget(identifier, newPassword) {
        assertPassword(newPassword, pwdPolicy);
        const user = identifier.kind === "userId"
            ? await store.findById(identifier.value)
            : identifier.kind === "phone"
                ? await store.findByPhone(normalizePhone(identifier.value) ?? "")
                : await store.findByEmail(normalizeEmail(identifier.value) ?? "");
        if (!user)
            throw new ZhanghaoError("USER_NOT_FOUND", "账号不存在");
        return user;
    }
    const service = {
        async register(input) {
            const username = requireUsername(input.username);
            assertPassword(input.password, pwdPolicy);
            const phone = normalizePhone(input.phone);
            const email = normalizeEmail(input.email);
            // 宿主常把「没填昵称」默认成用户名,而用户名常是手机号:注册这一处直接打码,不拒(拒了等于手机号用户注册不了)
            const nickname = input.nickname?.trim() ? maskPhonesInText(input.nickname.trim()) : null;
            checkNickname(nickname);
            const passwordHash = await hasher.hash(input.password);
            // 注册管控的名额占位 / 内测码扣减:同事务、建号之前。抛错 = 整个注册回滚
            if (input.beforeCreate)
                await input.beforeCreate(input.tx);
            const res = await store.insertUserIfAbsent({
                username,
                passwordHash,
                phone,
                email,
                nickname,
                avatarKey: null,
                role: input.role ?? "user",
                registerMeta: input.registerMeta ?? null,
            }, input.tx);
            if (!res.ok)
                throw conflictError(res.conflict);
            // 钱包 / 注册礼包等与建号同生共死的副作用:必须在同一个宿主事务里
            if (input.afterCreate)
                await input.afterCreate(res.user, input.tx);
            const sid = randomUUID();
            const tokens = await issueTokens(res.user, sid, input.meta);
            if (single)
                await single.bind(res.user.userId, sid, input.meta ?? undefined);
            emit({ type: "registered", userId: res.user.userId, meta: input.meta });
            return { user: res.user, tokens };
        },
        async login(input) {
            const ip = input.meta?.ip ?? undefined;
            // 用户名优先、查不到再按手机号 / 邮箱,开了昵称登录再按昵称(顺序与理由见 identifier.ts loginLookupOrder)
            const lookups = loginLookupOrder(input.identifier, { nickname: nicknameLogin });
            let found = null;
            for (const ident of lookups) {
                if (ident.kind === "nickname") {
                    // 构造时已校验 store 实现了它(nicknameLogin 才会产出这一步)
                    found = pickUniqueNicknameMatch(await (store.findManyForLoginByNickname
                        ? store.findManyForLoginByNickname(ident.value, NICKNAME_LOGIN_CANDIDATE_LIMIT)
                        : missingStoreMethod("findManyForLoginByNickname")));
                }
                else {
                    found = await store.findForLogin({ kind: ident.kind, value: ident.value });
                }
                if (found)
                    break;
            }
            // guard 的 account:存在用 u:<id>,不存在用 n:<登录名> —— 不存在的号也必须计数,
            // 否则「不存在的号永远不会被锁」本身就是枚举预言机
            //   不存在时按「最像什么」的归一化值计数(邮箱小写、手机号去分隔符),同一个号的不同写法共用一个计数器
            const account = found ? `u:${found.user.userId}` : `n:${classifyIdentifier(input.identifier).value}`;
            if (guard) {
                const chk = await guard.check(account, ip ?? undefined);
                if (!chk.allowed) {
                    emit({ type: "login_failed", account, reason: "locked", meta: input.meta });
                    throw new ZhanghaoError("LOGIN_LOCKED", "尝试过于频繁,请稍后再试", {
                        retryAfterSec: chk.retryAfterSec ?? 0,
                    });
                }
            }
            const fail = async () => {
                if (guard)
                    await guard.record(account, false, ip ?? undefined);
                emit({ type: "login_failed", account, reason: "bad_credentials", meta: input.meta });
                // 「不存在」与「密码错」共用这一个出口:响应逐字相同
                throw new ZhanghaoError("BAD_CREDENTIALS", "账号或密码不正确");
            };
            if (!found) {
                // 不存在也要走一次哈希验证,避免「查不到就秒回」的耗时差成为预言机
                await hasher.verify(input.password ?? "", "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
                return fail();
            }
            const okPassword = await hasher.verify(input.password ?? "", found.passwordHash);
            if (!okPassword)
                return fail();
            if (isBanned(found.user)) {
                if (guard)
                    await guard.record(account, false, ip ?? undefined);
                emit({ type: "login_failed", account, reason: "banned", meta: input.meta });
                throw new ZhanghaoError("ACCOUNT_BANNED", found.user.bannedReason ?? "账号已被封禁", {
                    bannedUntil: found.user.bannedUntil,
                });
            }
            // 角色不符也给 BAD_CREDENTIALS:后台登录页不该告诉人「这个号是存在的,只是不是管理员」
            if (input.requireRole && found.user.role !== input.requireRole)
                return fail();
            if (guard)
                await guard.record(account, true, ip ?? undefined);
            // 哈希不是当前实现产出的(换过算法)→ 验过之后透明重哈希,玩家无感
            if (hasher.owns && !hasher.owns(found.passwordHash)) {
                await store.updatePasswordHash(found.user.userId, await hasher.hash(input.password));
            }
            const sid = randomUUID();
            const tokens = await issueTokens(found.user, sid, input.meta);
            if (single)
                await single.bind(found.user.userId, sid, input.meta ?? undefined);
            emit({ type: "login_ok", userId: found.user.userId, sid, meta: input.meta });
            return { user: found.user, tokens };
        },
        async verifyAccess(accessToken) {
            const payload = verifyJwt(accessToken, secrets, { now: now() });
            if (payload.typ !== "access")
                throw new ZhanghaoError("TOKEN_INVALID", "凭证类型不正确");
            const userId = typeof payload.sub === "string" ? payload.sub : "";
            const sid = typeof payload.sid === "string" ? payload.sid : "";
            const jti = typeof payload.jti === "string" ? payload.jti : "";
            if (!userId || !sid || !jti)
                throw new ZhanghaoError("TOKEN_INVALID", "凭证格式不正确");
            // 刻意不查库:任何实例都能验 access。被挤下线是 KV 里的一次判断,不是一次 SQL
            if (single) {
                const chk = await single.check(userId, sid);
                if (!chk.ok)
                    throw new ZhanghaoError("SESSION_KICKED", chk.message ?? kickedMessage);
            }
            return {
                userId,
                role: payload.role === "admin" ? "admin" : "user",
                sid,
                jti,
                issuedAt: new Date((typeof payload.iat === "number" ? payload.iat : 0) * 1000),
                expiresAt: new Date((typeof payload.exp === "number" ? payload.exp : 0) * 1000),
            };
        },
        async refresh(refreshToken, meta) {
            const payload = verifyJwt(refreshToken, secrets, { now: now() });
            if (payload.typ !== "refresh")
                throw new ZhanghaoError("TOKEN_INVALID", "凭证类型不正确");
            const jti = typeof payload.jti === "string" ? payload.jti : "";
            if (!jti)
                throw new ZhanghaoError("TOKEN_INVALID", "凭证格式不正确");
            const raw = await kv.get(K.refresh(jti));
            if (!raw)
                throw new ZhanghaoError("TOKEN_INVALID", "凭证无效");
            let rec;
            try {
                rec = JSON.parse(raw);
            }
            catch {
                throw new ZhanghaoError("TOKEN_INVALID", "凭证无效");
            }
            // 一张已经轮换过的 refresh 又出现 = 它被别人拿到了。整条会话链一起吊销,宁可全体重登
            if (rec.status === "used") {
                await revokeAllSessions(rec.userId, "refresh_reused");
                throw new ZhanghaoError("REFRESH_REUSED", "登录状态异常,请重新登录");
            }
            const user = await store.findById(rec.userId);
            if (!user)
                throw new ZhanghaoError("USER_NOT_FOUND", "账号不存在");
            if (isBanned(user))
                throw new ZhanghaoError("ACCOUNT_BANNED", user.bannedReason ?? "账号已被封禁");
            // 标 used 而不是删:删了就分不清「重放」与「早就过期」,泄露检测会失灵。
            // 老宿主迁移进来的存量记录可能没有 exp(它们靠 Redis TTL 过期):没有就按整段 refresh 寿命兜底,
            // 绝不能算出 NaN 交给 kv(那会让「标 used」静默失败 → 重放检测对存量会话失灵)。
            const nowSec = Math.floor(now().getTime() / 1000);
            const ttlLeft = Number.isFinite(rec.exp) ? Math.max(1, rec.exp - nowSec) : refreshTtl;
            await kv.set(K.refresh(jti), JSON.stringify({ ...rec, status: "used" }), ttlLeft);
            await kv.srem(K.sessions(rec.userId), jti);
            // sid 继承:续签不是新设备。存量记录若没有 sid(更老的宿主实现),这一轮给它新建一个,用户无感
            const tokens = await issueTokens(user, rec.sid || randomUUID(), meta);
            return { user, tokens };
        },
        async issueSession(userId, meta) {
            const user = await mustGet(userId);
            if (isBanned(user))
                throw new ZhanghaoError("ACCOUNT_BANNED", user.bannedReason ?? "账号已被封禁", { bannedUntil: user.bannedUntil });
            const sid = randomUUID();
            const tokens = await issueTokens(user, sid, meta);
            if (single)
                await single.bind(user.userId, sid, meta ?? undefined);
            emit({ type: "login_ok", userId: user.userId, sid, meta });
            return { user, tokens };
        },
        async logout(refreshToken) {
            let jti = "";
            try {
                const payload = verifyJwt(refreshToken, secrets, { now: now() });
                jti = typeof payload.jti === "string" ? payload.jti : "";
            }
            catch {
                return; // 登出是幂等的:凭证坏了也当作已经登出,不给攻击者任何信息
            }
            if (!jti)
                return;
            const raw = await kv.get(K.refresh(jti));
            await kv.del(K.refresh(jti));
            if (raw) {
                try {
                    const rec = JSON.parse(raw);
                    await kv.srem(K.sessions(rec.userId), jti); // 只动自己这一台,别的设备不受影响
                }
                catch {
                    /* 记录坏了也已经删掉,无事可做 */
                }
            }
        },
        revokeAllSessions,
        /* ── 本人 ── */
        async me(userId) {
            return toMe(await mustGet(userId));
        },
        async updateProfile(userId, patch) {
            const current = await mustGet(userId);
            const next = {};
            if ("nickname" in patch) {
                const nick = patch.nickname?.trim();
                next.nickname = nick ? nick : null; // 空串按「没设昵称」处理,读取时再派生玩家{id}
                checkNickname(next.nickname, current.nickname);
            }
            if ("avatarKey" in patch)
                next.avatarKey = patch.avatarKey ?? null;
            await store.updateProfile(userId, next);
            return toMe(await mustGet(userId));
        },
        async changePassword(userId, oldPassword, newPassword) {
            const current = await store.passwordHashOf(userId);
            if (current === null)
                throw new ZhanghaoError("USER_NOT_FOUND", "账号不存在");
            if (!(await hasher.verify(oldPassword ?? "", current))) {
                throw new ZhanghaoError("BAD_CREDENTIALS", "原密码不正确");
            }
            assertPassword(newPassword, pwdPolicy);
            await store.updatePasswordHash(userId, await hasher.hash(newPassword));
            // 吊销放在写库成功之后:KV 不进 PG 事务,提前吊销会在回滚后留下「密码没变但被登出」
            await revokeAllSessions(userId, "password_changed");
            emit({ type: "password_changed", userId, by: "self" });
        },
        async checkResetPassword(identifier, newPassword) {
            return { userId: (await resolveResetTarget(identifier, newPassword)).userId };
        },
        async checkRegister(input) {
            requireUsername(input.username);
            assertPassword(input.password, pwdPolicy);
            /* 占用预检与 insertUserIfAbsent 的冲突判定用同一套规范化与同一个错误构造,
               否则「预检说能注册、落库说被占用」两边文案会不一致 */
            if (await store.findByUsername(requireUsername(input.username)))
                throw conflictError("username");
            const phone = normalizePhone(input.phone);
            if (phone && (await store.findByPhone(phone)))
                throw conflictError("phone");
            const email = normalizeEmail(input.email);
            if (email && (await store.findByEmail(email)))
                throw conflictError("email");
        },
        async resetPassword(identifier, newPassword) {
            const user = await resolveResetTarget(identifier, newPassword);
            await store.updatePasswordHash(user.userId, await hasher.hash(newPassword));
            await revokeAllSessions(user.userId, "password_reset");
            emit({ type: "password_changed", userId: user.userId, by: "reset" });
            return { userId: user.userId };
        },
        async bindPhone(userId, phone) {
            await mustGet(userId);
            const value = normalizePhone(phone);
            // 刻意不验旧号:旧号收不到短信正是改绑的主因;新号的码由宿主先验完
            if (!(await store.updateIdentifierIfFree(userId, "phone", value)))
                throw conflictError("phone");
            return toMe(await mustGet(userId));
        },
        async bindEmail(userId, email) {
            await mustGet(userId);
            const value = normalizeEmail(email);
            if (!(await store.updateIdentifierIfFree(userId, "email", value)))
                throw conflictError("email");
            return toMe(await mustGet(userId));
        },
        /* ── 公开投影 ── */
        async publicUser(userId) {
            const rows = await store.findManyByIds([userId]);
            const first = rows[0];
            return first ? toPublic(first) : null;
        },
        async publicUsers(userIds) {
            const out = new Map();
            if (userIds.length === 0)
                return out;
            // 批量取:一屏几十条留言不能逐个查;去重后每批至多 PUBLIC_USERS_BATCH 个,单条 SQL 不随调用方传多少无限变大
            const unique = [...new Set(userIds)];
            for (let i = 0; i < unique.length; i += PUBLIC_USERS_BATCH) {
                for (const u of await store.findManyByIds(unique.slice(i, i + PUBLIC_USERS_BATCH)))
                    out.set(u.userId, toPublic(u));
            }
            return out;
        },
        /* ── 后台 ── */
        admin: {
            async search(query) {
                const filter = {
                    ...parseSearchQuery(query.query),
                    limit: Math.min(Math.max(1, query.limit ?? DEFAULT_SEARCH_LIMIT), MAX_SEARCH_LIMIT),
                };
                if (query.role)
                    filter.role = query.role;
                if (query.status)
                    filter.status = query.status;
                if (query.createdFrom)
                    filter.createdFrom = query.createdFrom;
                if (query.createdTo)
                    filter.createdTo = query.createdTo;
                if (query.beforeUserId)
                    filter.beforeUserId = query.beforeUserId;
                return store.search(filter);
            },
            get: (userId) => mustGet(userId),
            async ban(userId, input, ctx) {
                const days = input.days;
                const until = days === null ? null : new Date(now().getTime() + days * 24 * 3600 * 1000);
                const detail = days === null ? `永久封禁:${input.reason}` : `封禁 ${days} 天:${input.reason}`;
                return runIdempotent(ctx, userId, "ban", detail, async () => {
                    await store.updateProfile(userId, { status: "banned", bannedUntil: until, bannedReason: input.reason });
                    await revokeAllSessions(userId, "banned");
                }, (u) => u.status === "banned");
            },
            async unban(userId, input, ctx) {
                return runIdempotent(ctx, userId, "unban", `解封:${input.reason}`, async () => {
                    await store.updateProfile(userId, { status: "active", bannedUntil: null, bannedReason: null });
                }, (u) => u.status === "active");
            },
            async setNickname(userId, nickname, ctx) {
                const next = nickname?.trim() ? nickname.trim() : null;
                checkNickname(next, (await mustGet(userId)).nickname);
                return runIdempotent(ctx, userId, "nickname", (u) => (next === null ? `清空昵称(原「${u.nickname ?? ""}」)` : `昵称「${u.nickname ?? ""}」→「${next}」`), async () => {
                    await store.updateProfile(userId, { nickname: next });
                }, (u) => (u.nickname ?? null) === next);
            },
            async setUsername(userId, username, ctx) {
                const name = requireUsername(username);
                // 改登录名后旧会话必须全断:否则原持有者还能用旧 token 继续用这个号
                return setIdentifier(userId, "username", name, "username", (u) => `登录用户名 ${u.username} → ${name}`, ctx, () => revokeAllSessions(userId, "username_changed"));
            },
            async setPhone(userId, phone, input, ctx) {
                const value = normalizePhone(phone);
                return setIdentifier(userId, "phone", value, "phone", (u) => `手机号 ${maskPhone(u.phone) ?? "(空)"} → ${maskPhone(value) ?? "(解绑)"};原因:${input.reason}`, ctx);
            },
            async setEmail(userId, email, input, ctx) {
                const value = normalizeEmail(email);
                return setIdentifier(userId, "email", value, "email", (u) => `邮箱 ${maskEmail(u.email) ?? "(空)"} → ${maskEmail(value) ?? "(解绑)"};原因:${input.reason}`, ctx);
            },
            async resetPassword(userId, newPassword, ctx) {
                assertPassword(newPassword, pwdPolicy);
                // 审计只记事不记密码 —— 新密码一个字符都不许进 detail
                return runIdempotent(ctx, userId, "password_reset", "重置密码并吊销全部会话", async () => {
                    await store.updatePasswordHash(userId, await hasher.hash(newPassword));
                    await revokeAllSessions(userId, "admin_password_reset");
                    emit({ type: "password_changed", userId, by: "admin" });
                });
            },
            async revokeSessions(userId, input, ctx) {
                return runIdempotent(ctx, userId, "revoke_sessions", `强制下线:${input.reason}`, async () => {
                    await revokeAllSessions(userId, "admin_revoke");
                });
            },
            async loginLock(userId) {
                if (!guard)
                    return { lockedForSec: 0, failCount: 0 }; // 没接防护就没有锁定,不假装有
                const info = await guard.inspect(`u:${userId}`);
                return { lockedForSec: info.lockedForSec, failCount: info.failCount };
            },
            async resetLoginLock(userId, input, ctx) {
                // 理由进审计:「谁在什么时候为什么解的锁」缺一不可,与 unban / revokeSessions 同口径
                return runIdempotent(ctx, userId, "login_lock_reset", `解除登录锁定;原因:${input.reason}`, async () => {
                    if (guard)
                        await guard.reset(`u:${userId}`);
                });
            },
            async listActions(userId, options) {
                const limit = Math.min(Math.max(1, options?.limit ?? DEFAULT_SEARCH_LIMIT), MAX_SEARCH_LIMIT);
                const opts = { limit };
                if (options?.beforeId)
                    opts.beforeId = options.beforeId;
                return store.listAdminActions(userId, opts);
            },
        },
    };
    return service;
}
