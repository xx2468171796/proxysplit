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
import type { AdminActionKind, UserRole, UserStatus, ZhanghaoErrorCode } from "../types.ts";
/** 本人资料。**只有 phoneMasked/emailMasked**,完整号一律不出现在响应体里 */
export interface MeView {
    userId: string;
    username: string;
    nickname: string | null;
    avatarKey: string | null;
    phoneMasked: string | null;
    emailMasked: string | null;
    role: UserRole;
    createdAt: string;
}
/** 玩家之间互相可见的全部内容 —— 结构上没有 username / phone / email */
export interface PublicUserView {
    userId: string;
    displayName: string;
    avatarKey: string | null;
}
/** 时间一律 ISO 字符串:前端 `new Date(x)` 即可,不用猜是秒还是毫秒 */
export interface TokenPairView {
    accessToken: string;
    refreshToken: string;
    sid: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
}
/** 注册 / 登录 / 续签的统一回执 */
export interface AuthResultView {
    user: MeView;
    tokens: TokenPairView;
}
export interface OkView {
    ok: true;
}
/** 后台可见的完整行(Date→ISO)。只出现在 auth:"admin" 的路由上 */
export interface AdminUserView {
    userId: string;
    username: string;
    phone: string | null;
    email: string | null;
    nickname: string | null;
    avatarKey: string | null;
    role: UserRole;
    status: UserStatus;
    bannedUntil: string | null;
    bannedReason: string | null;
    registerMeta: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
}
export interface AdminActionView {
    id: string;
    requestId: string;
    operatorId: string;
    targetUserId: string;
    action: AdminActionKind;
    /** 人读的一句话,**只记事不记密码** */
    detail: string;
    createdAt: string;
}
/** 后台动作回执。replayed=true 表示这个 requestId 此前已执行、本次没有二次生效 */
export interface AdminActionResultView {
    ok: true;
    replayed: boolean;
    user: AdminUserView;
}
export interface AdminUserListView {
    items: AdminUserView[];
}
export interface AdminActionListView {
    items: AdminActionView[];
}
export interface LoginLockView {
    lockedForSec: number;
    failCount: number;
}
/** 策略是宿主配置系统里的东西,包**只读**;后台页照着显示,改策略走宿主自己的配置口 */
export interface RegistrationPolicyView {
    enabled: boolean;
    dailyLimit: number | null;
    betaCode: "off" | "optional" | "required";
    device: {
        limit: number | null;
        action: "block" | "flag";
    };
}
export interface AdminRegistrationView {
    policy: RegistrationPolicyView;
    /** 当前自然日(策略时区)YYYY-MM-DD */
    dayKey: string;
    /** 下次名额重置时刻(ISO) */
    resetAt: string;
    /** dailyLimit 为 null 时两者都是 null */
    dailyUsed: number | null;
    dailyRemaining: number | null;
    /** store 有没有实现对应能力(没实现而策略开了 = 注册会被 fail closed 拒掉,后台要能看见) */
    storeSupports: {
        betaCodes: boolean;
        dailyLimit: boolean;
        device: boolean;
    };
}
export interface AdminBetaCodeView {
    id: string;
    code: string;
    note: string;
    maxUses: number | null;
    usedCount: number;
    enabled: boolean;
    expiresAt: string | null;
    createdBy: string | null;
    createdAt: string;
    /** 启用 且 未过期 且 未用尽(服务端派生,前端不重算) */
    usable: boolean;
}
export interface AdminBetaCodeListView {
    items: AdminBetaCodeView[];
}
/** 批量建码回执。`created` 是本次**真正新建**的;`existing` 是已存在被跳过的码(重放同 requestId 时 created 为空) */
export interface AdminBetaCodeCreateView {
    created: AdminBetaCodeView[];
    existing: string[];
}
/** 错误体形状全站统一;detail 只放结构化补充(如剩余锁定秒数),**不放内部堆栈/SQL** */
export interface ErrorBody {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
}
/**
 * 验证载荷(滑块票 / PoW 解 / 短信邮箱码)。两种摆法处理器都认:
 *   1. 嵌套:`{ ..., verification: { captchaToken, code } }`(手写客户端推荐);
 *   2. 平铺:`{ ..., captchaToken, code }`(`zhanghao/react` 的 `createZhanghaoApiFromClient` 就是这么发的)。
 * 字段名由宿主配的 `verify` 钩子解释(`zhanghao/yanzheng` 默认 captchaToken / captchaTokenPow / code)。
 */
export type VerificationPayload = Record<string, unknown>;
export interface RegisterBody {
    username: string;
    password: string;
    /** 内测码(处理器 trim + 大写;只有配了 registration-control 才会被读) */
    betaCode?: string | null;
    /** 带了 phone/email 且处理器配了 `verify.code` 钩子 → 先验对应渠道的注册码;没配钩子 = 宿主自己先验完 */
    phone?: string | null;
    email?: string | null;
    nickname?: string | null;
    /** 注册登记信息(IP / 设备指纹 / 渠道),宿主自定义 */
    registerMeta?: Record<string, unknown> | null;
    /** **刻意没有 role**:客户端能自选角色就是提权漏洞,handlers 里也不读这个键 */
    verification?: VerificationPayload;
}
export interface LoginBody {
    /** 用户名 / 手机号 / 邮箱三选一,服务端按形状识别 */
    identifier: string;
    password: string;
    /** 后台登录页传 "admin":普通用户密码正确也建立不了会话 */
    requireRole?: UserRole;
    verification?: VerificationPayload;
}
/** token 模式传 refreshToken;cookie 模式留空,handlers 从 cookie 读 */
export interface RefreshBody {
    refreshToken?: string;
}
export type LogoutBody = RefreshBody;
export interface UpdateProfileBody {
    nickname?: string | null;
    avatarKey?: string | null;
}
export interface ChangePasswordBody {
    oldPassword: string;
    newPassword: string;
}
export interface BindPhoneBody {
    /** null = 解绑(解绑不验码) */
    phone: string | null;
    verification?: VerificationPayload;
}
export interface BindEmailBody {
    email: string | null;
    verification?: VerificationPayload;
}
/** 找回密码:kind=phone/email 时由 `verify.code` 钩子验码(推荐 `zhanghao/yanzheng`);没配钩子 = 宿主自己先验完 */
export interface ResetPasswordBody {
    identifier: {
        kind: "phone" | "email" | "userId";
        value: string;
    };
    newPassword: string;
    verification?: VerificationPayload;
}
export interface AdminSearchQuery {
    /** 一个框:纯数字同时按 userId 与手机号,否则按用户名/昵称/邮箱 */
    query?: string;
    role?: UserRole;
    status?: UserStatus;
    createdFrom?: string;
    createdTo?: string;
    /** keyset 翻页:只取 userId 比它小的 */
    beforeUserId?: string;
    limit?: string;
}
export interface AdminListActionsQuery {
    beforeId?: string;
    limit?: string;
}
export interface AdminBanBody {
    /** null = 永久 */
    days: number | null;
    reason: string;
}
export interface AdminReasonBody {
    reason: string;
}
export interface AdminNicknameBody {
    nickname: string | null;
}
export interface AdminUsernameBody {
    username: string;
}
export interface AdminPhoneBody {
    phone: string | null;
    reason: string;
}
export interface AdminEmailBody {
    email: string | null;
    reason: string;
}
export interface AdminPasswordBody {
    password: string;
}
export interface AdminBetaCodeListQuery {
    /** 码前缀 */
    query?: string;
    status?: "all" | "usable" | "unusable";
    beforeId?: string;
    limit?: string;
}
/**
 * 批量建码。`codes` 与 `count` 二选一:给 `codes` 用你的码(会 trim + 大写);给 `count` 由服务端
 * **按 requestId 确定性派生**(同 requestId 重放得到同一批码 → 撞唯一索引 → created 为空),所以幂等不用另开表。
 */
export interface AdminBetaCodeCreateBody {
    codes?: string[];
    /** 1..200 */
    count?: number;
    /** 派生码的前缀(只在 count 模式下用) */
    prefix?: string;
    note?: string;
    /** null / 省略 = 不限 */
    maxUses?: number | null;
    /** ISO;null / 省略 = 永不过期 */
    expiresAt?: string | null;
}
/** 改码:没给的字段不动;`maxUses: null` = 改成不限,`expiresAt: null` = 改成永不过期 */
export interface AdminBetaCodeUpdateBody {
    note?: string;
    maxUses?: number | null;
    enabled?: boolean;
    expiresAt?: string | null;
}
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
export declare const HTTP_STATUS_BY_CODE: Record<ZhanghaoErrorCode, number>;
export type HttpMethod = "GET" | "POST" | "PATCH";
/** none = 匿名可调;user = 需要登录;admin = 需要 role==="admin"(鉴权由宿主做,handlers 只复核) */
export type RouteAuth = "none" | "user" | "admin";
export interface RouteDef {
    readonly key: string;
    readonly method: HttpMethod;
    /** 相对路径,`:id` 是路径参数 */
    readonly path: string;
    readonly auth: RouteAuth;
    readonly summary: string;
    /** 请求体 DTO 的类型名(给 OpenAPI 与人读;TS 侧由 handlers 的签名保证) */
    readonly body?: string;
    readonly query?: string;
    readonly response: string;
    /** 后台写动作:**必须带 requestId**(幂等锚),缺了 400 */
    readonly requiresRequestId?: boolean;
}
declare const RAW_ROUTES: readonly [{
    readonly key: "register";
    readonly method: "POST";
    readonly path: "/auth/register";
    readonly auth: "none";
    readonly summary: "注册并直接建立会话";
    readonly body: "RegisterBody";
    readonly response: "AuthResultView";
}, {
    readonly key: "login";
    readonly method: "POST";
    readonly path: "/auth/login";
    readonly auth: "none";
    readonly summary: "用户名/手机/邮箱 + 密码登录";
    readonly body: "LoginBody";
    readonly response: "AuthResultView";
}, {
    readonly key: "refresh";
    readonly method: "POST";
    readonly path: "/auth/refresh";
    readonly auth: "none";
    readonly summary: "续签(轮换;旧 jti 重放判泄露)";
    readonly body: "RefreshBody";
    readonly response: "AuthResultView";
}, {
    readonly key: "logout";
    readonly method: "POST";
    readonly path: "/auth/logout";
    readonly auth: "none";
    readonly summary: "只登出当前这一台设备";
    readonly body: "LogoutBody";
    readonly response: "OkView";
}, {
    readonly key: "resetPassword";
    readonly method: "POST";
    readonly path: "/auth/reset-password";
    readonly auth: "none";
    readonly summary: "找回密码(宿主已验完验证码)";
    readonly body: "ResetPasswordBody";
    readonly response: "OkView";
}, {
    readonly key: "me";
    readonly method: "GET";
    readonly path: "/me";
    readonly auth: "user";
    readonly summary: "我的资料(手机/邮箱掩码)";
    readonly response: "MeView";
}, {
    readonly key: "updateProfile";
    readonly method: "PATCH";
    readonly path: "/me";
    readonly auth: "user";
    readonly summary: "改昵称 / 头像";
    readonly body: "UpdateProfileBody";
    readonly response: "MeView";
}, {
    readonly key: "changePassword";
    readonly method: "POST";
    readonly path: "/me/password";
    readonly auth: "user";
    readonly summary: "改密码(验旧密码;成功后全部会话吊销)";
    readonly body: "ChangePasswordBody";
    readonly response: "OkView";
}, {
    readonly key: "bindPhone";
    readonly method: "POST";
    readonly path: "/me/phone";
    readonly auth: "user";
    readonly summary: "改绑/解绑手机号";
    readonly body: "BindPhoneBody";
    readonly response: "MeView";
}, {
    readonly key: "bindEmail";
    readonly method: "POST";
    readonly path: "/me/email";
    readonly auth: "user";
    readonly summary: "改绑/解绑邮箱";
    readonly body: "BindEmailBody";
    readonly response: "MeView";
}, {
    readonly key: "publicUser";
    readonly method: "GET";
    readonly path: "/users/:id";
    readonly auth: "none";
    readonly summary: "别人的公开资料(只有昵称与头像)";
    readonly response: "PublicUserView";
}, {
    readonly key: "adminSearch";
    readonly method: "GET";
    readonly path: "/admin/users";
    readonly auth: "admin";
    readonly summary: "模糊检索用户";
    readonly query: "AdminSearchQuery";
    readonly response: "AdminUserListView";
}, {
    readonly key: "adminGet";
    readonly method: "GET";
    readonly path: "/admin/users/:id";
    readonly auth: "admin";
    readonly summary: "用户详情(完整行)";
    readonly response: "AdminUserView";
}, {
    readonly key: "adminBan";
    readonly method: "POST";
    readonly path: "/admin/users/:id/ban";
    readonly auth: "admin";
    readonly summary: "封禁";
    readonly body: "AdminBanBody";
    readonly response: "AdminActionResultView";
    readonly requiresRequestId: true;
}, {
    readonly key: "adminUnban";
    readonly method: "POST";
    readonly path: "/admin/users/:id/unban";
    readonly auth: "admin";
    readonly summary: "解封";
    readonly body: "AdminReasonBody";
    readonly response: "AdminActionResultView";
    readonly requiresRequestId: true;
}, {
    readonly key: "adminSetNickname";
    readonly method: "POST";
    readonly path: "/admin/users/:id/nickname";
    readonly auth: "admin";
    readonly summary: "改昵称";
    readonly body: "AdminNicknameBody";
    readonly response: "AdminActionResultView";
    readonly requiresRequestId: true;
}, {
    readonly key: "adminSetUsername";
    readonly method: "POST";
    readonly path: "/admin/users/:id/username";
    readonly auth: "admin";
    readonly summary: "改登录名(吊销全部会话)";
    readonly body: "AdminUsernameBody";
    readonly response: "AdminActionResultView";
    readonly requiresRequestId: true;
}, {
    readonly key: "adminSetPhone";
    readonly method: "POST";
    readonly path: "/admin/users/:id/phone";
    readonly auth: "admin";
    readonly summary: "改绑手机号";
    readonly body: "AdminPhoneBody";
    readonly response: "AdminActionResultView";
    readonly requiresRequestId: true;
}, {
    readonly key: "adminSetEmail";
    readonly method: "POST";
    readonly path: "/admin/users/:id/email";
    readonly auth: "admin";
    readonly summary: "改绑邮箱";
    readonly body: "AdminEmailBody";
    readonly response: "AdminActionResultView";
    readonly requiresRequestId: true;
}, {
    readonly key: "adminResetPassword";
    readonly method: "POST";
    readonly path: "/admin/users/:id/password";
    readonly auth: "admin";
    readonly summary: "重置密码(吊销全部会话)";
    readonly body: "AdminPasswordBody";
    readonly response: "AdminActionResultView";
    readonly requiresRequestId: true;
}, {
    readonly key: "adminRevokeSessions";
    readonly method: "POST";
    readonly path: "/admin/users/:id/revoke-sessions";
    readonly auth: "admin";
    readonly summary: "吊销该用户全部会话";
    readonly body: "AdminReasonBody";
    readonly response: "AdminActionResultView";
    readonly requiresRequestId: true;
}, {
    readonly key: "adminResetLoginLock";
    readonly method: "POST";
    readonly path: "/admin/users/:id/login-lock/reset";
    readonly auth: "admin";
    readonly summary: "解除登录锁定";
    readonly body: "AdminReasonBody";
    readonly response: "AdminActionResultView";
    readonly requiresRequestId: true;
}, {
    readonly key: "adminLoginLock";
    readonly method: "GET";
    readonly path: "/admin/users/:id/login-lock";
    readonly auth: "admin";
    readonly summary: "查看登录锁定状态";
    readonly response: "LoginLockView";
}, {
    readonly key: "adminListActions";
    readonly method: "GET";
    readonly path: "/admin/users/:id/actions";
    readonly auth: "admin";
    readonly summary: "该账号的后台动作审计";
    readonly query: "AdminListActionsQuery";
    readonly response: "AdminActionListView";
}, {
    readonly key: "adminRegistration";
    readonly method: "GET";
    readonly path: "/admin/registration";
    readonly auth: "admin";
    readonly summary: "注册管控现状:策略只读 + 今日名额用量 + store 能力";
    readonly response: "AdminRegistrationView";
}, {
    readonly key: "adminListBetaCodes";
    readonly method: "GET";
    readonly path: "/admin/beta-codes";
    readonly auth: "admin";
    readonly summary: "内测码列表(keyset)";
    readonly query: "AdminBetaCodeListQuery";
    readonly response: "AdminBetaCodeListView";
}, {
    readonly key: "adminCreateBetaCodes";
    readonly method: "POST";
    readonly path: "/admin/beta-codes";
    readonly auth: "admin";
    readonly summary: "批量建码(≤200;同 requestId 重放不多建)";
    readonly body: "AdminBetaCodeCreateBody";
    readonly response: "AdminBetaCodeCreateView";
    readonly requiresRequestId: true;
}, {
    readonly key: "adminUpdateBetaCode";
    readonly method: "POST";
    readonly path: "/admin/beta-codes/:id";
    readonly auth: "admin";
    readonly summary: "改码:启停 / 备注 / 次数 / 到期";
    readonly body: "AdminBetaCodeUpdateBody";
    readonly response: "AdminBetaCodeView";
    readonly requiresRequestId: true;
}];
export type ZhanghaoRouteKey = (typeof RAW_ROUTES)[number]["key"];
export interface ZhanghaoRoute extends RouteDef {
    readonly key: ZhanghaoRouteKey;
}
/**
 * 对外是「宽类型的只读数组」:key 仍是字面量联合(客户端/处理器靠它穷举),
 * 但 body / query / requiresRequestId 这类**可选**字段可以直接读 —— 纯 `as const` 的元组
 * 里每条是各自的字面量对象类型,遍历时访问「这一条恰好没有的键」会 TS 报错,遍历代码根本没法写。
 */
export declare const ZHANGHAO_ROUTES: readonly ZhanghaoRoute[];
/** 按 key 取路由(客户端与处理器都用它,避免第二份路径常量) */
export declare const ROUTE_BY_KEY: Record<ZhanghaoRouteKey, RouteDef>;
/** `/admin/users/:id/ban` → `/admin/users/u1/ban`(路径参数会被 encode) */
export declare function fillPath(path: string, params?: Record<string, string | undefined>): string;
/**
 * 从 ROUTES 生成最小 OpenAPI 3 文档 —— **同源派生**,所以文档不可能和实现对不上。
 * schema 粗(object),意义在于路径/方法/鉴权/DTO 名与真实路由逐条一致。
 */
export declare function toOpenApi(opts?: {
    title?: string;
    version?: string;
    basePath?: string;
}): Record<string, unknown>;
export {};