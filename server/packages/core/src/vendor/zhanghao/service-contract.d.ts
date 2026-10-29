/**
 * 领域服务的公开面(接口)。实现在 service.ts;http / react / 文档 / 测试都只认这一份签名。
 * 先定契约再并行实现 —— 改签名先改这里,再改实现与文档。
 */
import type { NicknameRule } from "./nickname.ts";
import type { UsernameRule } from "./username.ts";
import type { Clock, KvLike, LoginGuard, PasswordHasher, SingleSession } from "./ports.ts";
import type { StoreTx, ZhanghaoStore } from "./store/types.ts";
import type { AccessClaims, AdminActionRecord, AdminActionResult, AdminSearchQuery, MeProfile, PublicUser, SessionMeta, TokenPair, UserRecord, UserRole } from "./types.ts";
export interface PasswordPolicy {
    /** 默认 6;业主 2026-09-15 拍板:**只限长度,不做弱口令字典/字符种类/含用户名检查**,也不许加回来 */
    minLength?: number;
    /** 默认 128 */
    maxLength?: number;
}
/**
 * 用户名规则 = `zhanghao/username` 的 `UsernameRule`(服务端与前端预检同一个 explainUsername)。
 * 不传任何字段 = 3–32 位字母 / 数字 / 下划线、拒纯数字。
 *   pattern         整体正则(传了就只按它判,错误只能给「用户名格式不正确」)
 *   minLength / maxLength / charset   分开写时每条有具体中文理由(1.9.0)
 *   forbiddenChars  禁用字符,如 ["@"](1.9.0;只管新注册 / 改用户名,不影响老账号登录)
 *   allowAllDigits  默认 false:纯数字用户名会与手机号形状撞车(生产真发生过 34 个登录名就是手机号),默认拒
 *   messages        文案覆盖
 */
export interface UsernamePolicy extends UsernameRule {
}
/** 登录选项(1.9.0) */
export interface LoginPolicy {
    /**
     * 昵称也能登录,默认 false(行为与 1.8.x 逐字相同)。开了之后 loginLookupOrder 在最后追加昵称一支:
     * 用户名 → 邮箱 / 手机号 → 昵称。**只在恰好一个账号叫这个昵称时命中**,多于一个当查不到
     * (理由见 identifier.ts pickUniqueNicknameMatch)。
     * 开了而 store 没实现 `findManyForLoginByNickname` → createZhanghao 直接抛 STORE_UNAVAILABLE(fail closed)。
     */
    nickname?: boolean;
}
export interface ZhanghaoConfig {
    /** access 有效期秒,默认 900 */
    accessTtlSec?: number;
    /** refresh 有效期秒,默认 14 天 */
    refreshTtlSec?: number;
    password?: PasswordPolicy;
    username?: UsernamePolicy;
    login?: LoginPolicy;
    /**
     * 昵称规范(1.10.0,默认开,用包自带词表、不限长度):register / updateProfile / admin.setNickname 三处都判,
     * 不合规抛 VALIDATION「您的昵称不符合规范,请重新输入」。昵称**没改**时不判(资料页常把旧昵称一起提交)。
     * 传 NicknameRule 加长度 / 站点追加词;传 `false` 整个关掉(须业主拍板)。前端预检 `explainNickname` 传同一个常量。
     */
    nickname?: NicknameRule | false;
    /** 昵称为空时的派生规则,默认 `玩家{userId}`;宿主可换 */
    fallbackDisplayName?: (userId: string) => string;
    /** 被挤下线的提示文案 */
    kickedMessage?: string;
}
export interface ZhanghaoOptions {
    store: ZhanghaoStore;
    kv: KvLike;
    /** access/refresh 签名密钥(HS256);轮换时传 [current, ...previous],验签依次试 */
    secret: string | string[];
    /** 各站必须不同,深圳那台 Redis 多站共用 */
    keyPrefix: string;
    hasher?: PasswordHasher;
    clock?: Clock;
    loginGuard?: LoginGuard;
    singleSession?: SingleSession;
    config?: ZhanghaoConfig;
    /**
     * 事件流(fire-and-forget,不 await 不抛):registered / login_ok / login_failed / password_changed /
     * sessions_revoked / admin_action。宿主接看板或 risk_events 用。
     */
    onEvent?: (event: ZhanghaoEvent) => void;
    /** 1.18.0 内部告警出口(如后台动作退坑失败);默认 console.warn */
    onWarn?: (message: string, extra?: Record<string, unknown>) => void;
}
export type ZhanghaoEvent = {
    type: "registered";
    userId: string;
    meta?: SessionMeta;
} | {
    type: "login_ok";
    userId: string;
    sid: string;
    meta?: SessionMeta;
} | {
    type: "login_failed";
    account: string;
    reason: "bad_credentials" | "banned" | "locked";
    meta?: SessionMeta;
} | {
    type: "password_changed";
    userId: string;
    by: "self" | "reset" | "admin";
} | {
    type: "sessions_revoked";
    userId: string;
    reason: string;
} | {
    type: "admin_action";
    action: AdminActionRecord;
};
export interface RegisterInput {
    username: string;
    password: string;
    /** 宿主已完成短信/邮箱验证后才传;包只做归一化与唯一性 */
    phone?: string | null;
    email?: string | null;
    nickname?: string | null;
    registerMeta?: Record<string, unknown> | null;
    role?: UserRole;
    /** 宿主事务:钱包、注册礼包等与建号同生共死的副作用放 afterCreate 里 */
    tx?: StoreTx;
    /**
     * 建号**之前**、同一事务内跑的钩子(在密码哈希与归一化都通过之后、insertUserIfAbsent 之前)。
     * 注册管控的「占今日名额」「扣内测码」放这里:它们必须与建号同生共死 —— 抛错 = 整个注册回滚,
     * 名额/码自动归还;放在事务外先扣,后面用户名撞了那一格就永远回不来了(旧站真这么坏过)。
     */
    beforeCreate?: (tx: StoreTx | undefined) => Promise<void>;
    afterCreate?: (user: UserRecord, tx: StoreTx | undefined) => Promise<void>;
    meta?: SessionMeta;
}
export interface LoginInput {
    /** 用户名 / 手机号 / 邮箱三选一,包按形状识别(identifier.ts) */
    identifier: string;
    password: string;
    /** 只允许该角色登录(后台登录页传 "admin";普通用户正确密码也进不来) */
    requireRole?: UserRole;
    meta?: SessionMeta;
}
export interface AdminContext {
    operatorId: string;
    /** 幂等锚:同一 requestId 重放不二次生效。前端在动作开始时生成一次并在重试时复用 */
    requestId: string;
}
export interface Zhanghao {
    register(input: RegisterInput): Promise<{
        user: UserRecord;
        tokens: TokenPair;
    }>;
    login(input: LoginInput): Promise<{
        user: UserRecord;
        tokens: TokenPair;
    }>;
    /** 只验签、不查库(任意实例可验);singleSession 接了会顺带查是否被挤 */
    verifyAccess(accessToken: string): Promise<AccessClaims>;
    /** 轮换:旧 refresh 标 used;重放已 used 的 jti = 泄露,吊销整个用户全部会话并抛 REFRESH_REUSED */
    refresh(refreshToken: string, meta?: SessionMeta): Promise<{
        user: UserRecord;
        tokens: TokenPair;
    }>;
    /** 只吊销当前这一台(按 refresh jti),不动别的设备 */
    logout(refreshToken: string): Promise<void>;
    /**
     * 宿主**自己完成了认证**之后签发一条会话(第三方登录 / Steam / 后台代登 / 宿主自带的登录闸门链)。
     * 不验密码、不过 loginGuard;singleSession 接了会 bind。被封禁的账号拒绝(ACCOUNT_BANNED)。
     */
    issueSession(userId: string, meta?: SessionMeta): Promise<{
        user: UserRecord;
        tokens: TokenPair;
    }>;
    /** 吊销该用户全部会话(改密 / 封号 / 判泄露 / 后台动作共用) */
    revokeAllSessions(userId: string, reason: string): Promise<void>;
    me(userId: string): Promise<MeProfile>;
    updateProfile(userId: string, patch: {
        nickname?: string | null;
        avatarKey?: string | null;
    }): Promise<MeProfile>;
    /** 验旧密码 → 长度闸门 → 写新哈希 → 吊销全部会话 */
    changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void>;
    /** 找回密码:宿主先验完短信/邮箱码,再调这个;不要求旧密码;吊销全部会话 */
    resetPassword(identifier: {
        kind: "phone" | "email" | "userId";
        value: string;
    }, newPassword: string): Promise<{
        userId: string;
    }>;
    /**
     * 找回密码的「只查不写」:长度闸门 + 查号,失败抛与 `resetPassword` **逐字相同**的错误。
     * 给这条顺序用(INTEGRATION §6.5):只读校验验证码 → **这里** → 真正消费验证码 → `resetPassword`。
     * 不先查就消费,号不存在 / 密码太短时码已经烧了,用户改完再提交看到的是「验证码已过期」。
     * ⚠ 必须排在验码(至少是只读校验)**之后**调 —— 排在前面就是零成本的号码枚举器。
     */
    checkResetPassword(identifier: {
        kind: "phone" | "email" | "userId";
        value: string;
    }, newPassword: string): Promise<{
        userId: string;
    }>;
    /**
     * 注册的「只查不写」:用户名规则 + 长度闸门 + 用户名/手机/邮箱占用,失败抛与 `register` 相同的错误。
     * 给「只读校验验证码 → 这里 → 真正消费验证码 → register」用。占用仍以 `register` 里的唯一约束为准
     * (两步之间可能被别人抢注),这里只是让**可预见的**失败别烧掉用户的码。
     */
    checkRegister(input: Pick<RegisterInput, "username" | "password" | "phone" | "email">): Promise<void>;
    /** 改绑手机/邮箱:宿主先验完新号的码;刻意不验旧号(旧号收不到短信正是改绑的主因) */
    bindPhone(userId: string, phone: string | null): Promise<MeProfile>;
    bindEmail(userId: string, email: string | null): Promise<MeProfile>;
    publicUser(userId: string): Promise<PublicUser | null>;
    publicUsers(userIds: string[]): Promise<Map<string, PublicUser>>;
    admin: {
        search(query: AdminSearchQuery): Promise<UserRecord[]>;
        get(userId: string): Promise<UserRecord>;
        ban(userId: string, input: {
            days: number | null;
            reason: string;
        }, ctx: AdminContext): Promise<AdminActionResult>;
        unban(userId: string, input: {
            reason: string;
        }, ctx: AdminContext): Promise<AdminActionResult>;
        setNickname(userId: string, nickname: string | null, ctx: AdminContext): Promise<AdminActionResult>;
        /** 撞唯一 → USERNAME_TAKEN;成功吊销全部会话 */
        setUsername(userId: string, username: string, ctx: AdminContext): Promise<AdminActionResult>;
        setPhone(userId: string, phone: string | null, input: {
            reason: string;
        }, ctx: AdminContext): Promise<AdminActionResult>;
        setEmail(userId: string, email: string | null, input: {
            reason: string;
        }, ctx: AdminContext): Promise<AdminActionResult>;
        /** 不要求旧密码;长度闸门同玩家;审计只记事不记密码;吊销全部会话 */
        resetPassword(userId: string, newPassword: string, ctx: AdminContext): Promise<AdminActionResult>;
        revokeSessions(userId: string, input: {
            reason: string;
        }, ctx: AdminContext): Promise<AdminActionResult>;
        loginLock(userId: string): Promise<{
            lockedForSec: number;
            failCount: number;
        }>;
        resetLoginLock(userId: string, input: {
            reason: string;
        }, ctx: AdminContext): Promise<AdminActionResult>;
        listActions(userId: string, opts?: {
            beforeId?: string;
            limit?: number;
        }): Promise<AdminActionRecord[]>;
    };
}