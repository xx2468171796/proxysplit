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
import { type AdminActionListView, type AdminBanBody, type AdminBetaCodeCreateBody, type AdminBetaCodeCreateView, type AdminBetaCodeListQuery, type AdminBetaCodeListView, type AdminBetaCodeUpdateBody, type AdminBetaCodeView, type AdminRegistrationView, type AdminEmailBody, type AdminNicknameBody, type AdminPasswordBody, type AdminPhoneBody, type AdminReasonBody, type AdminSearchQuery, type AdminUserListView, type AdminUserView, type AdminActionResultView, type AuthResultView, type BindEmailBody, type BindPhoneBody, type ChangePasswordBody, type LoginBody, type LoginLockView, type MeView, type OkView, type PublicUserView, type RegisterBody, type ResetPasswordBody, type TokenPairView, type UpdateProfileBody } from "./http/wire.ts";
export declare class ZhanghaoClientError extends Error {
    readonly status: number;
    readonly code: string;
    readonly detail: Record<string, unknown> | undefined;
    constructor(status: number, code: string, message: string, detail?: Record<string, unknown>);
}
export interface ZhanghaoClientOptions {
    /** 挂载前缀,如 "/api";默认同源根 */
    baseUrl?: string;
    /** 注入 fetch(测试/SSR 用);默认 globalThis.fetch */
    fetch?: typeof fetch;
    /** 外部 token 源(如从 store 读)。cookie 鉴权的宿主不用给 */
    getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
    /** 外部 refresh token 源;cookie 鉴权不用给 */
    getRefreshToken?: () => string | null | undefined | Promise<string | null | undefined>;
    /** 登录/注册/续签拿到新 token 时回调(宿主落地到 store);cookie 模式可以不管 */
    onTokens?: (tokens: TokenPairView) => void;
    /** 续签也失败 = 这条会话真没了(过期/被挤/判泄露):宿主跳登录页 */
    onUnauthorized?: (err: ZhanghaoClientError) => void;
    /** 默认 "include"(同源 cookie 鉴权) */
    credentials?: RequestCredentials;
    /** 每次请求附加头 */
    headers?: () => Record<string, string>;
    /**
     * 1.18.0:单个请求的超时毫秒,默认 10000;0 = 不设超时。超时抛 `ZhanghaoClientError(0, "TIMEOUT")`。
     * 没有超时的话,一次挂死的续签会让在途单飞 promise 永不结束,之后所有带登录态的请求都跟着卡死。
     */
    timeoutMs?: number;
}
export interface ZhanghaoClient {
    register(body: RegisterBody): Promise<AuthResultView>;
    login(body: LoginBody): Promise<AuthResultView>;
    refresh(): Promise<AuthResultView>;
    logout(): Promise<OkView>;
    resetPassword(body: ResetPasswordBody): Promise<OkView>;
    me(): Promise<MeView>;
    updateProfile(body: UpdateProfileBody): Promise<MeView>;
    changePassword(body: ChangePasswordBody): Promise<OkView>;
    bindPhone(body: BindPhoneBody): Promise<MeView>;
    bindEmail(body: BindEmailBody): Promise<MeView>;
    publicUser(id: string): Promise<PublicUserView>;
    adminSearch(query?: AdminSearchQuery): Promise<AdminUserListView>;
    adminGet(id: string): Promise<AdminUserView>;
    adminBan(id: string, body: AdminBanBody, requestId: string): Promise<AdminActionResultView>;
    adminUnban(id: string, body: AdminReasonBody, requestId: string): Promise<AdminActionResultView>;
    adminSetNickname(id: string, body: AdminNicknameBody, requestId: string): Promise<AdminActionResultView>;
    adminSetUsername(id: string, body: AdminUsernameBodyLike, requestId: string): Promise<AdminActionResultView>;
    adminSetPhone(id: string, body: AdminPhoneBody, requestId: string): Promise<AdminActionResultView>;
    adminSetEmail(id: string, body: AdminEmailBody, requestId: string): Promise<AdminActionResultView>;
    adminResetPassword(id: string, body: AdminPasswordBody, requestId: string): Promise<AdminActionResultView>;
    adminRevokeSessions(id: string, body: AdminReasonBody, requestId: string): Promise<AdminActionResultView>;
    adminResetLoginLock(id: string, body: AdminReasonBody, requestId: string): Promise<AdminActionResultView>;
    adminLoginLock(id: string): Promise<LoginLockView>;
    adminListActions(id: string, query?: {
        beforeId?: string;
        limit?: string;
    }): Promise<AdminActionListView>;
    adminRegistration(): Promise<AdminRegistrationView>;
    adminListBetaCodes(query?: AdminBetaCodeListQuery): Promise<AdminBetaCodeListView>;
    adminCreateBetaCodes(body: AdminBetaCodeCreateBody, requestId: string): Promise<AdminBetaCodeCreateView>;
    adminUpdateBetaCode(id: string, body: AdminBetaCodeUpdateBody, requestId: string): Promise<AdminBetaCodeView>;
    /** 手动塞入 token(宿主从别处恢复会话时用) */
    setTokens(tokens: {
        accessToken: string;
        refreshToken?: string;
    } | null): void;
}
interface AdminUsernameBodyLike {
    username: string;
}
export declare function createZhanghaoClient(options?: ZhanghaoClientOptions): ZhanghaoClient;
export {};