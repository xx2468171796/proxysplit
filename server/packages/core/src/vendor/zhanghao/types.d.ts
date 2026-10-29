/**
 * zhanghao(账号)—— 公共类型与错误。整个包只认这里定义的形状;
 * store / service / http / react 都从这一份 import,不许各自再抄一份。
 *
 * 隐私纪律(与 liaotian / tuiguang 同):
 *   - userId 是不透明字符串(宿主列可以是 bigint,经 userIdCodec 换算);
 *   - 「公开投影」PublicUser 里只有 userId / displayName / avatarKey / level,
 *     **永不带 username / phone / email** —— 玩家之间只能看到昵称。
 */
export type UserRole = "user" | "admin";
export type UserStatus = "active" | "banned";
/** 完整账号行(只给本人与后台;公开面用 PublicUser) */
export interface UserRecord {
    userId: string;
    username: string;
    /** 已归一化(normalizePhone 后)的手机号 */
    phone: string | null;
    /** 已归一化(小写、trim)的邮箱 */
    email: string | null;
    nickname: string | null;
    avatarKey: string | null;
    role: UserRole;
    status: UserStatus;
    bannedUntil: Date | null;
    bannedReason: string | null;
    /** 注册时留下的登记信息(IP / 设备指纹 / 渠道等),宿主自定义,包只透传 */
    registerMeta: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
}
/** 玩家之间互相能看到的投影 —— 结构上拿不到登录名与手机号 */
export interface PublicUser {
    userId: string;
    displayName: string;
    avatarKey: string | null;
}
/** 本人看到的资料 */
export interface MeProfile {
    userId: string;
    username: string;
    nickname: string | null;
    avatarKey: string | null;
    /** 掩码手机号(138****0000);完整号只在改绑时由宿主验证码链路接触 */
    phoneMasked: string | null;
    emailMasked: string | null;
    role: UserRole;
    createdAt: Date;
}
/** 一对 token。access 无状态(只验签),refresh 有状态(Redis/KV 记录,轮换) */
export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    /** 会话 id:登录时新建、续签时继承;单设备挤下线按它判 */
    sid: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
}
export interface AccessClaims {
    userId: string;
    role: UserRole;
    sid: string;
    /** 本张 token 的唯一 id */
    jti: string;
    issuedAt: Date;
    expiresAt: Date;
}
export interface SessionMeta {
    ip?: string | null;
    ua?: string | null;
    deviceId?: string | null;
    label?: string | null;
}
export type AdminActionKind = "ban" | "unban" | "nickname" | "username" | "phone" | "email" | "password_reset" | "revoke_sessions" | "login_lock_reset";
/** 后台对某账号做过的每一次动作(幂等锚是 requestId) */
export interface AdminActionRecord {
    id: string;
    requestId: string;
    operatorId: string;
    targetUserId: string;
    action: AdminActionKind;
    /** 人读的一句话,**只记事不记密码** */
    detail: string;
    createdAt: Date;
}
export interface AdminActionResult {
    ok: true;
    /** true = 这个 requestId 此前已执行,本次未重复生效 */
    replayed: boolean;
    user: UserRecord;
}
/** 后台模糊检索条件。query 一个框:纯数字同时按 userId 与手机号,否则按用户名/昵称/邮箱 */
export interface AdminSearchQuery {
    query?: string;
    role?: UserRole;
    status?: UserStatus;
    /** 注册时间窗 */
    createdFrom?: Date;
    createdTo?: Date;
    /** keyset:只取 userId 比它小的(降序翻旧页) */
    beforeUserId?: string;
    limit?: number;
}
/**
 * 内测码一行(`zh_beta_codes`)。`code` 入库前已统一 `trim().toUpperCase()` —— 大小写不敏感靠**入库归一**,
 * 不靠查询时 `lower()`(后者会让唯一索引形同虚设)。`usedCount` 只由 store 的原子 `consumeBetaCode` 递增。
 */
export interface BetaCodeRecord {
    id: string;
    code: string;
    note: string;
    /** null = 不限次数 */
    maxUses: number | null;
    usedCount: number;
    enabled: boolean;
    /** null = 永不过期 */
    expiresAt: Date | null;
    /** 建码的操作员 userId;脚本建的可为 null */
    createdBy: string | null;
    createdAt: Date;
}
export type ZhanghaoErrorCode = "VALIDATION" | "USERNAME_TAKEN" | "PHONE_TAKEN" | "EMAIL_TAKEN" | "USER_NOT_FOUND" | "BAD_CREDENTIALS" | "ACCOUNT_BANNED" | "LOGIN_LOCKED" | "TOKEN_INVALID" | "TOKEN_EXPIRED" | "SESSION_KICKED" | "REFRESH_REUSED" | "FORBIDDEN" | "REQUEST_ID_CONFLICT"
/** 1.18.0 同 requestId 的动作已占坑但效果还看不到(正在执行 / 执行中崩了);`detail.stale` = 坑已超过 60 秒,多半要人工核对后换新 requestId */
 | "REQUEST_IN_PROGRESS" | "STORE_UNAVAILABLE"
/** 人机验证 / 一次性验证码没通过(HTTP 处理器的 `verify` 钩子抛;service 层不产生) */
 | "VERIFICATION_FAILED"
/** 注册总开关关着,且没有拿到有效内测码(关 = 只有内测码能进) */
 | "REGISTRATION_CLOSED"
/** 今日名额已满(北京自然日;`detail.resetAt` 是下次重置时刻) */
 | "REGISTRATION_FULL"
/** 内测码无效:不存在 / 停用 / 过期 / 用完 / 必填却没给(四种合成一句,不让人探出「这个码存在但用完了」) */
 | "BETA_CODE_INVALID"
/** 同一设备指纹下的账号数已到上限且策略是 block */
 | "DEVICE_LIMIT"
/** 调整记录不存在 */
 | "ADJUSTMENT_NOT_FOUND"
/** 改 / 删时版本对不上:别人刚改过,或已作废(`detail.revision` 是当前版本) */
 | "REVISION_CONFLICT";
export declare class ZhanghaoError extends Error {
    readonly code: ZhanghaoErrorCode;
    readonly detail: Record<string, unknown> | undefined;
    constructor(code: ZhanghaoErrorCode, message: string, detail?: Record<string, unknown>);
}
/**
 * 判断是不是 zhanghao 抛的业务错误。
 *
 * ⚠ **按 name + code 判,不用 instanceof**:Next.js(server action / route handler / RSC 分层打包)
 * 与 vendored+依赖并存的宿主里,同一个包会被加载成多份,`instanceof` 对另一份实例恒为 false ——
 * 表现是「用户名已被占用」变成「服务器内部异常」,且不报错(V7 2026-09-23 本地并发注册撞到)。
 */
export declare function isZhanghaoError(err: unknown, code?: ZhanghaoErrorCode): err is ZhanghaoError;