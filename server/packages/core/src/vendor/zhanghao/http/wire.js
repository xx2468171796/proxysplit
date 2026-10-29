/**
 * zhanghao 的 **唯一路由真相源**:路径、方法、鉴权档位、请求/响应 DTO 全在这一份里。
 *
 * 为什么要有 wire 这一层:处理器(handlers.ts)、浏览器客户端(client.ts)、OpenAPI 文档
 * 三处都从这里派生,路径就不会漂移。生产里踩过的同类坑是「下单发的字段是 A、回调按 B 去查」——
 * 两边各写一份常量,验签过、HTTP 200、订单永远不动,**全程不报错**。路由一旦散成两份,
 * 这类「看起来全绿、实际没接上」的故障就迟早复发。
 *
 * 隐私纪律(结构性,不是靠自觉):
 *   - 玩家侧响应 DTO 里 **没有** phone / email 字段,只有 phoneMasked / emailMasked;
 *   - 别人的信息只能走 PublicUserView(userId / displayName / avatarKey),
 *     结构上拿不到 username —— 本站登录名允许纯数字,生产上真出现过「登录名就是手机号」
 *     的账号被逐条挂在首页战报上。
 *   - 完整行只在 AdminUserView 里出现,而它只挂在 auth:"admin" 的路由上。
 *
 * 路径都是**相对**的,宿主自己挑前缀(如 /api)挂载;handlers 不做鉴权,只认宿主传进来的身份。
 */
/* ────────────────────────────── 错误码 → HTTP 状态 ────────────────────────────── */
/**
 * 映射表是穷举的(`Record<ZhanghaoErrorCode, number>`):types.ts 加了新码而这里没加,
 * **typecheck 当场红**。这比运行时 `?? 500` 好 —— 后者会把一个本该 409 的业务错
 * 静默降级成「服务器炸了」,运营查半天查不到。
 *
 * 几处刻意的选择:
 *   - BAD_CREDENTIALS 401:「不存在」与「密码错」共用这一个码、同一句话,防账号枚举。
 *     生产上真出过一次「不存在返 400、存在返 429」的状态码预言机,25 条单测各测各的路径、
 *     没人拿两条互相对照,于是全绿着上线。
 *   - LOGIN_LOCKED 429:是「等一会儿再来」不是「你没权限」,前端据此显示倒计时。
 *   - 四个会话类错误都 401:客户端只需认一个状态就能触发续签/重登。
 *   - STORE_UNAVAILABLE 503:依赖不可用,可重试;别混进 500。
 */
export const HTTP_STATUS_BY_CODE = {
    VALIDATION: 400,
    USERNAME_TAKEN: 409,
    PHONE_TAKEN: 409,
    EMAIL_TAKEN: 409,
    USER_NOT_FOUND: 404,
    BAD_CREDENTIALS: 401,
    ACCOUNT_BANNED: 403,
    LOGIN_LOCKED: 429,
    TOKEN_INVALID: 401,
    TOKEN_EXPIRED: 401,
    SESSION_KICKED: 401,
    REFRESH_REUSED: 401,
    FORBIDDEN: 403,
    REQUEST_ID_CONFLICT: 409,
    REQUEST_IN_PROGRESS: 409,
    STORE_UNAVAILABLE: 503,
    VERIFICATION_FAILED: 400,
    /* 注册管控:关门 403(不是你的问题,是门没开)、满员 429(等明天)、码不对 400、一机超限 403 */
    REGISTRATION_CLOSED: 403,
    REGISTRATION_FULL: 429,
    BETA_CODE_INVALID: 400,
    DEVICE_LIMIT: 403,
    /* 累充调整 */
    ADJUSTMENT_NOT_FOUND: 404,
    REVISION_CONFLICT: 409,
};
const RAW_ROUTES = [
    /* ── 玩家:注册 / 登录 / 会话 ── */
    { key: "register", method: "POST", path: "/auth/register", auth: "none", summary: "注册并直接建立会话", body: "RegisterBody", response: "AuthResultView" },
    { key: "login", method: "POST", path: "/auth/login", auth: "none", summary: "用户名/手机/邮箱 + 密码登录", body: "LoginBody", response: "AuthResultView" },
    { key: "refresh", method: "POST", path: "/auth/refresh", auth: "none", summary: "续签(轮换;旧 jti 重放判泄露)", body: "RefreshBody", response: "AuthResultView" },
    { key: "logout", method: "POST", path: "/auth/logout", auth: "none", summary: "只登出当前这一台设备", body: "LogoutBody", response: "OkView" },
    { key: "resetPassword", method: "POST", path: "/auth/reset-password", auth: "none", summary: "找回密码(宿主已验完验证码)", body: "ResetPasswordBody", response: "OkView" },
    /* ── 玩家:本人 ── */
    { key: "me", method: "GET", path: "/me", auth: "user", summary: "我的资料(手机/邮箱掩码)", response: "MeView" },
    { key: "updateProfile", method: "PATCH", path: "/me", auth: "user", summary: "改昵称 / 头像", body: "UpdateProfileBody", response: "MeView" },
    { key: "changePassword", method: "POST", path: "/me/password", auth: "user", summary: "改密码(验旧密码;成功后全部会话吊销)", body: "ChangePasswordBody", response: "OkView" },
    { key: "bindPhone", method: "POST", path: "/me/phone", auth: "user", summary: "改绑/解绑手机号", body: "BindPhoneBody", response: "MeView" },
    { key: "bindEmail", method: "POST", path: "/me/email", auth: "user", summary: "改绑/解绑邮箱", body: "BindEmailBody", response: "MeView" },
    /* ── 公开投影 ── */
    { key: "publicUser", method: "GET", path: "/users/:id", auth: "none", summary: "别人的公开资料(只有昵称与头像)", response: "PublicUserView" },
    /* ── 后台 ── */
    { key: "adminSearch", method: "GET", path: "/admin/users", auth: "admin", summary: "模糊检索用户", query: "AdminSearchQuery", response: "AdminUserListView" },
    { key: "adminGet", method: "GET", path: "/admin/users/:id", auth: "admin", summary: "用户详情(完整行)", response: "AdminUserView" },
    { key: "adminBan", method: "POST", path: "/admin/users/:id/ban", auth: "admin", summary: "封禁", body: "AdminBanBody", response: "AdminActionResultView", requiresRequestId: true },
    { key: "adminUnban", method: "POST", path: "/admin/users/:id/unban", auth: "admin", summary: "解封", body: "AdminReasonBody", response: "AdminActionResultView", requiresRequestId: true },
    { key: "adminSetNickname", method: "POST", path: "/admin/users/:id/nickname", auth: "admin", summary: "改昵称", body: "AdminNicknameBody", response: "AdminActionResultView", requiresRequestId: true },
    { key: "adminSetUsername", method: "POST", path: "/admin/users/:id/username", auth: "admin", summary: "改登录名(吊销全部会话)", body: "AdminUsernameBody", response: "AdminActionResultView", requiresRequestId: true },
    { key: "adminSetPhone", method: "POST", path: "/admin/users/:id/phone", auth: "admin", summary: "改绑手机号", body: "AdminPhoneBody", response: "AdminActionResultView", requiresRequestId: true },
    { key: "adminSetEmail", method: "POST", path: "/admin/users/:id/email", auth: "admin", summary: "改绑邮箱", body: "AdminEmailBody", response: "AdminActionResultView", requiresRequestId: true },
    { key: "adminResetPassword", method: "POST", path: "/admin/users/:id/password", auth: "admin", summary: "重置密码(吊销全部会话)", body: "AdminPasswordBody", response: "AdminActionResultView", requiresRequestId: true },
    { key: "adminRevokeSessions", method: "POST", path: "/admin/users/:id/revoke-sessions", auth: "admin", summary: "吊销该用户全部会话", body: "AdminReasonBody", response: "AdminActionResultView", requiresRequestId: true },
    { key: "adminResetLoginLock", method: "POST", path: "/admin/users/:id/login-lock/reset", auth: "admin", summary: "解除登录锁定", body: "AdminReasonBody", response: "AdminActionResultView", requiresRequestId: true },
    { key: "adminLoginLock", method: "GET", path: "/admin/users/:id/login-lock", auth: "admin", summary: "查看登录锁定状态", response: "LoginLockView" },
    { key: "adminListActions", method: "GET", path: "/admin/users/:id/actions", auth: "admin", summary: "该账号的后台动作审计", query: "AdminListActionsQuery", response: "AdminActionListView" },
    /* ── 后台:注册管控(要 createZhanghaoHttpHandlers 传 registration,否则 404) ── */
    { key: "adminRegistration", method: "GET", path: "/admin/registration", auth: "admin", summary: "注册管控现状:策略只读 + 今日名额用量 + store 能力", response: "AdminRegistrationView" },
    { key: "adminListBetaCodes", method: "GET", path: "/admin/beta-codes", auth: "admin", summary: "内测码列表(keyset)", query: "AdminBetaCodeListQuery", response: "AdminBetaCodeListView" },
    { key: "adminCreateBetaCodes", method: "POST", path: "/admin/beta-codes", auth: "admin", summary: "批量建码(≤200;同 requestId 重放不多建)", body: "AdminBetaCodeCreateBody", response: "AdminBetaCodeCreateView", requiresRequestId: true },
    { key: "adminUpdateBetaCode", method: "POST", path: "/admin/beta-codes/:id", auth: "admin", summary: "改码:启停 / 备注 / 次数 / 到期", body: "AdminBetaCodeUpdateBody", response: "AdminBetaCodeView", requiresRequestId: true },
];
/**
 * 对外是「宽类型的只读数组」:key 仍是字面量联合(客户端/处理器靠它穷举),
 * 但 body / query / requiresRequestId 这类**可选**字段可以直接读 —— 纯 `as const` 的元组
 * 里每条是各自的字面量对象类型,遍历时访问「这一条恰好没有的键」会 TS 报错,遍历代码根本没法写。
 */
export const ZHANGHAO_ROUTES = RAW_ROUTES;
/** 按 key 取路由(客户端与处理器都用它,避免第二份路径常量) */
export const ROUTE_BY_KEY = Object.fromEntries(ZHANGHAO_ROUTES.map((r) => [r.key, r]));
/** `/admin/users/:id/ban` → `/admin/users/u1/ban`(路径参数会被 encode) */
export function fillPath(path, params = {}) {
    return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => {
        const v = params[name];
        if (v === undefined || v === "")
            throw new Error(`zhanghao: 路径参数 ${name} 缺失`);
        return encodeURIComponent(v);
    });
}
/* ────────────────────────────── OpenAPI ────────────────────────────── */
/**
 * 从 ROUTES 生成最小 OpenAPI 3 文档 —— **同源派生**,所以文档不可能和实现对不上。
 * schema 粗(object),意义在于路径/方法/鉴权/DTO 名与真实路由逐条一致。
 */
export function toOpenApi(opts = {}) {
    const basePath = opts.basePath ?? "";
    const paths = {};
    for (const route of ZHANGHAO_ROUTES) {
        // OpenAPI 用 {id} 而不是 :id
        const p = basePath + route.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
        const params = [...route.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => ({
            name: m[1],
            in: "path",
            required: true,
            schema: { type: "string" },
        }));
        const op = {
            operationId: route.key,
            summary: route.summary,
            tags: [route.auth === "admin" ? "admin" : "player"],
            security: route.auth === "none" ? [] : [{ bearerAuth: [] }],
            responses: {
                "200": { description: route.response, content: { "application/json": { schema: { type: "object", title: route.response } } } },
                default: { description: "ErrorBody", content: { "application/json": { schema: { type: "object", title: "ErrorBody" } } } },
            },
        };
        if (params.length)
            op.parameters = params;
        if (route.query)
            op["x-query-schema"] = route.query;
        if (route.body) {
            op.requestBody = { required: true, content: { "application/json": { schema: { type: "object", title: route.body } } } };
        }
        if (route.requiresRequestId)
            op["x-requires-request-id"] = true;
        let bucket = paths[p];
        if (bucket === undefined) {
            bucket = {};
            paths[p] = bucket;
        }
        bucket[route.method.toLowerCase()] = op;
    }
    return {
        openapi: "3.0.3",
        info: { title: opts.title ?? "zhanghao", version: opts.version ?? "1.0.0" },
        components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
        paths,
    };
}
