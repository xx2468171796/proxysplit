/**
 * 浏览器端 REST 客户端 —— 按 `http/wire.ts` 的路由表发请求,方法名与 ROUTES 的 key 一一对应。
 *
 * 为什么这层要在包里而不是各宿主自己写,两起真实事故:
 *
 *  1. **「登录了之后掉线」**:服务端的 `/auth/refresh` 早就能用,但前端**从来没调过一次**
 *     (生产 86MB 日志里调用次数为 0)。access 只活 15 分钟,一到点就弹「已离线」强制重登。
 *     → 所以续签必须是客户端默认行为,不是宿主的可选功能。
 *
 *  2. **「并发续签把用户所有设备一起踢下线」**:refresh token 是轮换的,旧 jti 重放会被判泄露、
 *     吊销整条会话链。页面刚加载常有 5~10 个请求同时 401,各自拿同一个旧 refresh 去换,
 *     第一个成功、其余全是「重放」→ 用户在所有设备上一起被硬踢。
 *     → 所以是**单飞**:并发的 401 共享同一次在途续签,续完各自**只重放一次**。
 *
 * 零依赖;SSR 安全(不碰 window/document/localStorage)。
 */
import { ROUTE_BY_KEY, fillPath, } from "./http/wire.js";
export class ZhanghaoClientError extends Error {
    status;
    code;
    detail;
    constructor(status, code, message, detail) {
        super(message);
        this.name = "ZhanghaoClientError";
        this.status = status;
        this.code = code;
        this.detail = detail;
    }
}
const DEFAULT_TIMEOUT_MS = 10_000;
/** 这些路由自己就是认证动作,401 了不能再去续签(会无限递归) */
const AUTH_ROUTE_KEYS = new Set(["register", "login", "refresh", "logout", "resetPassword"]);
async function parse(res) {
    let body = null;
    try {
        body = await res.json();
    }
    catch {
        body = null;
    }
    if (!res.ok) {
        const e = (body ?? {});
        throw new ZhanghaoClientError(res.status, e.code ?? "HTTP_ERROR", e.message ?? `HTTP ${res.status}`, e.detail);
    }
    return body;
}
function requestUrl(baseUrl, path, init) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query ?? {})) {
        if (v === undefined || v === null || v === "")
            continue;
        qs.set(k, String(v));
    }
    return baseUrl + fillPath(path, init.params) + (qs.size ? `?${qs.toString()}` : "");
}
/** 不含 authorization:那一项要 await 取 token,由调用方在这之后补上 */
function requestHeaders(options, init) {
    const headers = { accept: "application/json", ...(options.headers?.() ?? {}) };
    if (init.body !== undefined)
        headers["content-type"] = "application/json";
    if (init.requestId)
        headers["x-request-id"] = init.requestId;
    return headers;
}
function adminActionVia(call) {
    return function adminAction(key, id, body, requestId) {
        /* requestId 由调用方(React 面板)在动作**开始时**生成一次、重试复用同一个 —— 在这里生成
           等于每次重试都是新锚,幂等就白做了。所以是必传参数而不是可选。 */
        if (!requestId)
            throw new ZhanghaoClientError(400, "VALIDATION", "后台动作必须带 requestId");
        return call(key, { params: { id }, body: { ...body, requestId }, requestId });
    };
}
/** 后台方法:只是把路由 key / 参数拼给 call / adminAction,不持有状态 */
function adminMethods(call, adminAction) {
    return {
        adminSearch: (query = {}) => call("adminSearch", { query: query }),
        adminGet: (id) => call("adminGet", { params: { id } }),
        adminBan: (id, body, requestId) => adminAction("adminBan", id, body, requestId),
        adminUnban: (id, body, requestId) => adminAction("adminUnban", id, body, requestId),
        adminSetNickname: (id, body, requestId) => adminAction("adminSetNickname", id, body, requestId),
        adminSetUsername: (id, body, requestId) => adminAction("adminSetUsername", id, body, requestId),
        adminSetPhone: (id, body, requestId) => adminAction("adminSetPhone", id, body, requestId),
        adminSetEmail: (id, body, requestId) => adminAction("adminSetEmail", id, body, requestId),
        adminResetPassword: (id, body, requestId) => adminAction("adminResetPassword", id, body, requestId),
        adminRevokeSessions: (id, body, requestId) => adminAction("adminRevokeSessions", id, body, requestId),
        adminResetLoginLock: (id, body, requestId) => adminAction("adminResetLoginLock", id, body, requestId),
        adminLoginLock: (id) => call("adminLoginLock", { params: { id } }),
        adminListActions: (id, query = {}) => call("adminListActions", { params: { id }, query: query }),
        adminRegistration: () => call("adminRegistration"),
        adminListBetaCodes: (query = {}) => call("adminListBetaCodes", { query: query }),
        adminCreateBetaCodes: (body, requestId) => {
            if (!requestId)
                throw new ZhanghaoClientError(400, "VALIDATION", "后台动作必须带 requestId");
            return call("adminCreateBetaCodes", { body: { ...body, requestId }, requestId });
        },
        adminUpdateBetaCode: (id, body, requestId) => {
            if (!requestId)
                throw new ZhanghaoClientError(400, "VALIDATION", "后台动作必须带 requestId");
            return call("adminUpdateBetaCode", { params: { id }, body: { ...body, requestId }, requestId });
        },
    };
}
/** 带超时的 fetch:超时统一抛 TIMEOUT(status 0),其它网络错误原样抛 */
async function timedFetch(fetchImpl, timeoutMs, url, init) {
    const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    try {
        return await fetchImpl(url, signal ? { ...init, signal } : init);
    }
    catch (err) {
        if (signal?.aborted)
            throw new ZhanghaoClientError(0, "TIMEOUT", "请求超时,请稍后重试");
        throw err;
    }
}
export function createZhanghaoClient(options = {}) {
    const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    const credentials = options.credentials ?? "include";
    /* 客户端自己拿到的最新 token(login/register/refresh 的产物)。
       优先于 options.getAccessToken:续签成功后必须**立刻**用新 token 重放,
       而宿主的 store 可能是异步/下一次渲染才更新 —— 拿旧 token 重放就是再一次 401。 */
    let currentAccess = null;
    let currentRefresh = null;
    /** 在途续签(单飞的核心):同一时刻最多一个 */
    let inflightRefresh = null;
    function adopt(tokens) {
        currentAccess = tokens.accessToken;
        currentRefresh = tokens.refreshToken;
        options.onTokens?.(tokens);
    }
    async function accessToken() {
        if (currentAccess)
            return currentAccess;
        return (await options.getAccessToken?.()) ?? null;
    }
    async function refreshToken() {
        if (currentRefresh)
            return currentRefresh;
        return (await options.getRefreshToken?.()) ?? null;
    }
    async function raw(key, init) {
        const route = ROUTE_BY_KEY[key];
        const url = requestUrl(baseUrl, route.path, init);
        const headers = requestHeaders(options, init);
        const token = await accessToken();
        if (token)
            headers.authorization = `Bearer ${token}`;
        return timedFetch(fetchImpl, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, url, {
            method: route.method,
            credentials,
            headers,
            ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        });
    }
    /**
     * 单飞续签:并发调用共享同一个在途 promise。**成功与失败都只发生一次**,
     * 所以旧 refresh 只会被消费一次,不会触发「重放 = 泄露」的整链吊销。
     */
    function refreshOnce() {
        if (inflightRefresh)
            return inflightRefresh;
        const run = (async () => {
            const rt = await refreshToken();
            const res = await raw("refresh", { body: rt ? { refreshToken: rt } : {} });
            const out = await parse(res);
            adopt(out.tokens);
            return out;
        })();
        inflightRefresh = run;
        // 不管成败都要清掉,否则一次失败会把之后所有续签永久卡在这个失败的 promise 上
        run.catch(() => undefined).finally(() => {
            if (inflightRefresh === run)
                inflightRefresh = null;
        });
        return run;
    }
    async function call(key, init = {}) {
        let res = await raw(key, init);
        if (res.status === 401 && !AUTH_ROUTE_KEYS.has(key)) {
            try {
                await refreshOnce();
            }
            catch (err) {
                // 续签也不行 = 会话真的没了。抛原始的 401 语义交给宿主跳登录
                const e = err instanceof ZhanghaoClientError ? err : new ZhanghaoClientError(401, "TOKEN_INVALID", "会话已失效");
                options.onUnauthorized?.(e);
                throw e;
            }
            // **只重放一次**:再 401 就如实抛出,不进重试循环
            res = await raw(key, init);
        }
        return parse(res);
    }
    async function auth(key, body) {
        if (key === "refresh")
            return refreshOnce();
        const out = await parse(await raw(key, { body }));
        adopt(out.tokens);
        return out;
    }
    const adminAction = adminActionVia(call);
    return {
        register: (body) => auth("register", body),
        login: (body) => auth("login", body),
        refresh: () => refreshOnce(),
        logout: async () => {
            const rt = await refreshToken();
            const out = await parse(await raw("logout", { body: rt ? { refreshToken: rt } : {} }));
            currentAccess = null;
            currentRefresh = null;
            return out;
        },
        resetPassword: (body) => call("resetPassword", { body }),
        me: () => call("me"),
        updateProfile: (body) => call("updateProfile", { body }),
        changePassword: async (body) => {
            const out = await call("changePassword", { body });
            // 改密会吊销全部会话(含本台),手上的 token 已经作废,留着只会让下一次请求 401
            currentAccess = null;
            currentRefresh = null;
            return out;
        },
        bindPhone: (body) => call("bindPhone", { body }),
        bindEmail: (body) => call("bindEmail", { body }),
        publicUser: (id) => call("publicUser", { params: { id } }),
        ...adminMethods(call, adminAction),
        setTokens: (tokens) => {
            currentAccess = tokens?.accessToken ?? null;
            currentRefresh = tokens?.refreshToken ?? null;
        },
    };
}
