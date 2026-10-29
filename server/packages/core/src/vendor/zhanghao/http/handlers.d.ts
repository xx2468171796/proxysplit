export { type ErrorKind, kindOfStatus } from "./error-kind.ts";
/**
 * 框架无关的 HTTP 处理器:输入「宿主已鉴权的身份 + 参数 + body」,输出 `{ status, body }`。
 * 宿主只剩三件事:**鉴权**(auth 从哪来)、**限流**、把处理器绑到自己的路由框架上
 * (Fetch API 的框架可以直接用本文件的 `bindToFetch`)。人机验证与短信/邮箱码通过 `verify` 钩子接
 * (`zhanghao/yanzheng` 一行摆进 yanzheng),不配就不验。
 *
 * 三条纪律:
 *  1. **鉴权在宿主,复核在这里**:auth:"user" 的路由收不到身份 → 401;auth:"admin" 的路由
 *     role 不是 admin → 403。宿主漏挂守卫时,这里是第二道闸而不是一路放行。
 *  2. **隐私结构性**:玩家侧响应体由 MeView / PublicUserView 两个形状封死,
 *     结构上出不了 phone/email 原文,也出不了别人的 username(测试用 JSON.stringify 兜底断言)。
 *  3. **内部错误绝不外泄**:非 ZhanghaoError 一律 500 + 固定文案,不回 message/stack —— 那些
 *     字符串里常带表名、SQL 片段、内网地址。
 *
 * body 里的 Date 全部转 ISO、bigint 全部转字符串(JSON.stringify 遇 bigint 会直接抛)。
 */
import type { RegisterInput, Zhanghao } from "../service-contract.ts";
import type { StoreTx } from "../store/types.ts";
import type { RegistrationControl } from "../registration-control.ts";
import { type SessionMeta, type UserRecord, type UserRole } from "../types.ts";
import { HTTP_STATUS_BY_CODE, ROUTE_BY_KEY, fillPath, type AdminActionListView, type AdminActionResultView, type AdminBetaCodeCreateView, type AdminBetaCodeListView, type AdminBetaCodeView, type AdminRegistrationView, type AdminUserListView, type AdminUserView, type AuthResultView, type ErrorBody, type LoginLockView, type MeView, type OkView, type PublicUserView, type ZhanghaoRouteKey } from "./wire.ts";
export { HTTP_STATUS_BY_CODE };
export interface HandlerAuth {
    userId: string;
    role: UserRole;
}
/** 建议宿主下发的 cookie(**建议**:token 放 body 还是 cookie 由宿主定,处理器两样都给) */
export interface CookieDirective {
    name: string;
    value: string;
    /** 0 = 立即失效(登出) */
    maxAgeSec: number;
    httpOnly: boolean;
    sameSite: "Lax" | "Strict" | "None";
    path: string;
    secure: boolean;
}
export interface HandlerInput {
    /** 宿主鉴权结果;匿名传 null/省略 */
    auth?: HandlerAuth | null;
    params?: {
        id?: string;
    };
    query?: Record<string, string | undefined>;
    body?: unknown;
    /** cookie 模式下 refresh token 从这里读 */
    cookies?: Record<string, string | undefined>;
    meta?: SessionMeta;
    /** 后台动作的幂等锚;也可放在 body.requestId 里 */
    requestId?: string;
    /** 请求头(小写键)。注册管控从 `x-device-fingerprint` 读设备指纹;`bindToFetch` 会透传 */
    headers?: Record<string, string | undefined>;
}
export interface HandlerResult<T = unknown> {
    status: number;
    body: T | ErrorBody | null;
    /** 只有 register/login/refresh/logout 会给 */
    setCookies?: CookieDirective[];
}
/** 会走验证钩子的五条路由 */
export type VerifyRoute = "register" | "login" | "resetPassword" | "bindPhone" | "bindEmail";
export type VerifyChannel = "phone" | "email";
/** 一次性验证码的用途,与 yanzheng `CodePurpose` 同一组字面量 */
export type VerifyCodePurpose = "register" | "reset" | "bind";
export interface VerifyContext {
    route: VerifyRoute;
    /** 原始请求体(已确认是对象) */
    body: Record<string, unknown>;
    auth?: HandlerAuth;
    meta?: SessionMeta;
    /**
     * 验证载荷:`body.verification` 是对象就取它,否则取整个 body(`zhanghao/react` 的适配层把
     * `verification` **平铺**进请求体顶层,两种摆法都要认)。缺省 `{}`。
     */
    verification: Record<string, unknown>;
}
export interface VerifyCodeContext extends VerifyContext {
    channel: VerifyChannel;
    /** 收码的手机号 / 邮箱原文(**未归一化**,与前端发码时填的是同一串;归一化交给验码方) */
    target: string;
    purpose: VerifyCodePurpose;
}
/** `verify.register` 的上下文:人机与验码都过了、还没建号 */
export interface VerifyRegisterContext extends VerifyContext {
    route: "register";
    /**
     * 设备指纹,只认 64 位小写 hex;依次取 `verification.fingerprint` → `body.registerMeta.fingerprint`
     * → `meta.deviceId`(bindToFetch 从 `x-device-fingerprint` 头填)→ `headers["x-device-fingerprint"]`。取不到 = null(软闸放行)
     */
    fingerprint: string | null;
    /** `body.betaCode` 经 trim + 大写;没带 = null */
    betaCode: string | null;
}
/**
 * `verify.register` 的裁决。拒绝就 throw(ZhanghaoError);放行返回:
 *   - `registerMeta`:合并进 `body.registerMeta`(同名键以裁决为准),随账号落库(指纹 / 内测码 / deviceOverLimit 都在这);
 *   - `beforeCreate`:在建号事务里、insertUserIfAbsent **之前**跑(占名额 / 扣码);抛错 = 整个注册回滚。
 */
export interface RegisterDecision {
    registerMeta?: Record<string, unknown>;
    beforeCreate?: (tx: StoreTx | undefined) => Promise<void>;
}
/**
 * 验证钩子。**不配 = 不验**(老宿主零影响);配了就在调 `zh.*` 之前按「先人机、再验码」的顺序调,
 * 不通过抛 `ZhanghaoError("VERIFICATION_FAILED")`(400)。推荐用 `zhanghao/yanzheng` 的 `withYanzheng(yz).verify`
 * 一行摆进来;自己实现也行,只要不通过就 throw。
 *
 *  - `captcha`:register / login / resetPassword 之前调(哪条路由真验、验什么由钩子自己决定)。
 *  - `code`:register(body 带 phone / email 时,各调一次)、resetPassword(kind=phone/email)、
 *    bindPhone / bindEmail(传 null 解绑**不调**)之前调。
 */
export interface VerificationHooks {
    captcha?: (ctx: VerifyContext) => Promise<void>;
    code?: (ctx: VerifyCodeContext) => Promise<void>;
    /**
     * **只读**校验验证码(验完不消费)。可选;提供了,register / resetPassword 走两段式:
     *
     *   人机 → peekCode(只读) → 注册管控 / 占用预检 / 长度闸门 / 查号 → code(真正消费) → 写库
     *
     * 不提供则保持老顺序「人机 → code(消费) → 其余检查 → 写库」—— 那样的话,名额满、
     * 内测码错、密码太短、号不存在任何一条拒绝时码都已经烧了,用户改完再提交看到的是
     * 「验证码已过期」,而码是一分钟前刚收到的(六个站都这么报过障)。
     * `withYanzheng` 在 yanzheng ≥ 2.4 时自动提供它。自己实现的钩子若会一律消费,**不要**提供这个
     * (否则后面那次真正消费会因为码已被删而判「已过期」)。
     */
    peekCode?: (ctx: VerifyCodeContext) => Promise<void>;
    /**
     * register:captcha → code **之后**、`zh.register` 之前调。注册管控(总开关 / 名额 / 内测码 / 一机 N 号)就挂在这:
     * `zhanghao/registration-control` 的 `createRegistrationControl(...).verifyRegister`。也可以直接给 `registration` 选项。
     */
    register?: (ctx: VerifyRegisterContext) => Promise<RegisterDecision | void>;
}
export interface ZhanghaoHttpOptions {
    /** 人机验证 / 一次性验证码钩子;不配 = 不验(见 VerificationHooks) */
    verify?: VerificationHooks;
    /**
     * 注册管控(`zhanghao/registration-control`)。传了:① `verify.register` 缺省用它的 `verifyRegister`;
     * ② 挂起 `/admin/registration` 与 `/admin/beta-codes*` 四条后台路由(不传时这四条回 404)。
     */
    registration?: RegistrationControl;
    /**
     * 注册的事务边界。传了:`register` 处理器把 `beforeCreate`(占名额 / 扣码)、建号、`afterCreate` 放进**同一个**宿主事务;
     * 不传:三步各自独立提交 —— 内存 store / 不在意原子性的演示可以不传,**生产接了名额或内测码必须传**。
     */
    transaction?: <T>(fn: (tx: StoreTx) => Promise<T>) => Promise<T>;
    /** 与建号同生共死的副作用(钱包 / 注册礼包 / 推广归因);拿到的 `user.registerMeta.deviceOverLimit` 为 true 时别发礼包 */
    afterCreate?: RegisterInput["afterCreate"];
    /** cookie 名,默认 zh_at / zh_rt */
    cookieNames?: {
        access?: string;
        refresh?: string;
    };
    /** cookie 属性建议;生产一律 secure:true + SameSite=Lax */
    cookie?: {
        path?: string;
        sameSite?: "Lax" | "Strict" | "None";
        secure?: boolean;
    };
    /** 挂在后台登录页时传 "admin":普通用户密码正确也建立不了会话 */
    requireRole?: UserRole;
    /** 非 ZhanghaoError 的兜底错误落到这里(宿主记日志/告警);处理器自己不打印 */
    onInternalError?: (err: unknown, routeKey: ZhanghaoRouteKey) => void;
}
export declare function adminUserView(u: UserRecord): AdminUserView;
declare function buildZhanghaoHttpHandlers(zh: Zhanghao, opts?: ZhanghaoHttpOptions): {
    register(input: HandlerInput): Promise<HandlerResult<AuthResultView>>;
    login(input: HandlerInput): Promise<HandlerResult<AuthResultView>>;
    refresh(input: HandlerInput): Promise<HandlerResult<AuthResultView>>;
    logout(input: HandlerInput): Promise<HandlerResult<OkView>>;
    resetPassword(input: HandlerInput): Promise<HandlerResult<OkView>>;
    me(input: HandlerInput): Promise<HandlerResult<MeView>>;
    updateProfile(input: HandlerInput): Promise<HandlerResult<MeView>>;
    changePassword(input: HandlerInput): Promise<HandlerResult<OkView>>;
    bindPhone(input: HandlerInput): Promise<HandlerResult<MeView>>;
    bindEmail(input: HandlerInput): Promise<HandlerResult<MeView>>;
    publicUser(input: HandlerInput): Promise<HandlerResult<PublicUserView>>;
    adminSearch(input: HandlerInput): Promise<HandlerResult<AdminUserListView>>;
    adminGet(input: HandlerInput): Promise<HandlerResult<AdminUserView>>;
    adminBan(input: HandlerInput): Promise<HandlerResult<AdminActionResultView>>;
    adminUnban(input: HandlerInput): Promise<HandlerResult<AdminActionResultView>>;
    adminSetNickname(input: HandlerInput): Promise<HandlerResult<AdminActionResultView>>;
    adminSetUsername(input: HandlerInput): Promise<HandlerResult<AdminActionResultView>>;
    adminSetPhone(input: HandlerInput): Promise<HandlerResult<AdminActionResultView>>;
    adminSetEmail(input: HandlerInput): Promise<HandlerResult<AdminActionResultView>>;
    adminResetPassword(input: HandlerInput): Promise<HandlerResult<AdminActionResultView>>;
    adminRevokeSessions(input: HandlerInput): Promise<HandlerResult<AdminActionResultView>>;
    adminResetLoginLock(input: HandlerInput): Promise<HandlerResult<AdminActionResultView>>;
    adminLoginLock(input: HandlerInput): Promise<HandlerResult<LoginLockView>>;
    adminListActions(input: HandlerInput): Promise<HandlerResult<AdminActionListView>>;
    adminRegistration(input: HandlerInput): Promise<HandlerResult<AdminRegistrationView>>;
    adminListBetaCodes(input: HandlerInput): Promise<HandlerResult<AdminBetaCodeListView>>;
    adminCreateBetaCodes(input: HandlerInput): Promise<HandlerResult<AdminBetaCodeCreateView>>;
    adminUpdateBetaCode(input: HandlerInput): Promise<HandlerResult<AdminBetaCodeView>>;
};
export type ZhanghaoHttpHandlers = ReturnType<typeof createZhanghaoHttpHandlers>;
export interface BindToFetchOptions {
    /** 挂载前缀,如 "/api";默认根 */
    basePath?: string;
    /** 从请求里解析身份(验 access token 等)。不给 = 全部匿名,只有 auth:"none" 的路由能用 */
    resolveAuth?: (req: Request) => Promise<HandlerAuth | null> | HandlerAuth | null;
    /** 真实客户端 IP(反代后 remote_addr 是反代自己的,必须宿主给) */
    resolveIp?: (req: Request) => string | null;
}
/**
 * 把处理器绑成一个 `(Request) => Response`,任何支持 Fetch API 的框架(Next.js Route Handler、
 * Hono、Bun、Deno、Cloudflare Workers)都能直接挂。宿主只需提供 `resolveAuth`。
 *
 * 路由匹配走 ZHANGHAO_ROUTES,**不再写第二份路径表** —— 这正是 wire 存在的理由。
 */
export declare function bindToFetch(handlers: ZhanghaoHttpHandlers, options?: BindToFetchOptions): (req: Request) => Promise<Response>;
export { fillPath, ROUTE_BY_KEY };
/** 对外的处理器：错误体统一带 kind（error-kind.ts，公司基础契约 jichu 的 ErrorBody） */
export declare function createZhanghaoHttpHandlers(zh: Zhanghao, opts?: ZhanghaoHttpOptions): ReturnType<typeof buildZhanghaoHttpHandlers>;