/**
 * 存储契约。包不假设 ORM,但**假设两张表长成 sql/schema.sql 那样**(users / admin_actions)。
 * 用 Drizzle + PG 的直接拿 store/drizzle-pg;原生 SQL(pg / postgres.js / Prisma $queryRaw)拿 store/sql-pg。
 *
 * 自己实现时有三处**不能用 ORM 的天真写法**:
 *   - insertUserIfAbsent:唯一性只信数据库约束(username / phone / email 三个部分唯一索引),
 *     撞约束返回 { conflict: "username" | "phone" | "email" }。「先查再插」在并发注册下会放进两个同名号。
 *   - updateIdentifierIfFree:改用户名/手机/邮箱同上,撞约束返回 false,不许先 select 再 update。
 *   - insertAdminActionIfAbsent:靠 requestId 唯一吃并发(on conflict do nothing + returning);
 *     返回 null = 这个 requestId 已执行过,service 据此回放不二次生效。
 *
 * `tx` 是宿主事务句柄(drizzle 的 tx 对象 / pg client),传了就在宿主事务里做。
 * 注册必须能带 tx:宿主要在同一事务里建钱包、发注册礼包(afterCreate)。
 */
import type { AdminActionKind, AdminActionRecord, AdminSearchQuery, BetaCodeRecord, UserRecord, UserRole, UserStatus } from "../types.ts";
export type StoreTx = unknown;
export interface InsertUserData {
    username: string;
    passwordHash: string;
    phone: string | null;
    email: string | null;
    nickname: string | null;
    avatarKey: string | null;
    role: UserRole;
    registerMeta: Record<string, unknown> | null;
}
export type UniqueField = "username" | "phone" | "email";
export type InsertUserResult = {
    ok: true;
    user: UserRecord;
} | {
    ok: false;
    conflict: UniqueField;
};
export interface UserPatch {
    nickname?: string | null;
    avatarKey?: string | null;
    status?: UserStatus;
    bannedUntil?: Date | null;
    bannedReason?: string | null;
}
export interface InsertAdminActionData {
    requestId: string;
    operatorId: string;
    targetUserId: string;
    action: AdminActionKind;
    detail: string;
}
/** 批量登记内测码的一行(code 已归一为大写) */
export interface BetaCodeInsert {
    code: string;
    note: string;
    maxUses: number | null;
    expiresAt: Date | null;
}
/** 改码:undefined = 不动,null = 清成「不限 / 永不过期」 */
export interface BetaCodePatch {
    note?: string;
    maxUses?: number | null;
    enabled?: boolean;
    expiresAt?: Date | null;
}
export interface BetaCodeListFilter {
    /** 码前缀(大写后 ILIKE 'q%') */
    query?: string;
    /** usable = 启用 且 未过期 且 未用尽;unusable = 其反 */
    status?: "all" | "usable" | "unusable";
    /** keyset:只取 id 比它小的(降序翻旧页) */
    beforeId?: string;
    limit: number;
}
export interface ZhanghaoStore {
    findById(userId: string, tx?: StoreTx): Promise<UserRecord | null>;
    findByUsername(username: string, tx?: StoreTx): Promise<UserRecord | null>;
    findByPhone(phone: string, tx?: StoreTx): Promise<UserRecord | null>;
    findByEmail(email: string, tx?: StoreTx): Promise<UserRecord | null>;
    /** 登录用:任一标识 → 行 + 哈希。返回 null 与「密码错」在 service 里合成同一个错误(防枚举) */
    findForLogin(identifier: {
        kind: UniqueField;
        value: string;
    }, tx?: StoreTx): Promise<{
        user: UserRecord;
        passwordHash: string;
    } | null>;
    /**
     * 昵称登录用(1.9.0,**可选**;宿主开了 config.login.nickname 才会被调,开了而没实现 → createZhanghao 抛 STORE_UNAVAILABLE)。
     * 按昵称等值(建议 lower() 不区分大小写)取**至多 limit 条**(service 传 NICKNAME_LOGIN_CANDIDATE_LIMIT = 2),
     * 顺序无所谓 —— 「恰好一个才命中」由 service 判,store 别自己挑一个返回。
     */
    findManyForLoginByNickname?(nickname: string, limit: number, tx?: StoreTx): Promise<Array<{
        user: UserRecord;
        passwordHash: string;
    }>>;
    passwordHashOf(userId: string, tx?: StoreTx): Promise<string | null>;
    /** 后台模糊检索,userId 降序,keyset;query 的解释规则在 service(identifier.ts),store 只收结构化条件 */
    search(filter: SearchFilter, tx?: StoreTx): Promise<UserRecord[]>;
    /** 批量取公开投影用(排行榜/留言板一屏几十个人),缺的不返回 */
    findManyByIds(userIds: string[], tx?: StoreTx): Promise<UserRecord[]>;
    insertUserIfAbsent(data: InsertUserData, tx?: StoreTx): Promise<InsertUserResult>;
    updatePasswordHash(userId: string, passwordHash: string, tx?: StoreTx): Promise<void>;
    /** 改唯一标识;撞约束返 false。value=null 表示解绑(username 不许 null,由 service 挡) */
    updateIdentifierIfFree(userId: string, field: UniqueField, value: string | null, tx?: StoreTx): Promise<boolean>;
    updateProfile(userId: string, patch: UserPatch, tx?: StoreTx): Promise<void>;
    insertAdminActionIfAbsent(data: InsertAdminActionData, tx?: StoreTx): Promise<AdminActionRecord | null>;
    findAdminActionByRequestId(requestId: string, tx?: StoreTx): Promise<AdminActionRecord | null>;
    /** 某账号的动作流水,id 降序 */
    listAdminActions(targetUserId: string, opts: {
        beforeId?: string;
        limit: number;
    }, tx?: StoreTx): Promise<AdminActionRecord[]>;
    /**
     * 1.18.0 **可选**:按 requestId 删掉那条审计(`delete ... where request_id = $1`)。
     * service 先用 insertAdminActionIfAbsent「占坑」再改数据,改数据失败时靠它把坑退回去,
     * 这样同 requestId 并发只有赢家真正执行、失败的动作也不留审计。
     * 没实现的老 store 退回旧顺序(先查回放 → 改 → 记审计),并发同 requestId 仍可能各执行一次。
     */
    releaseAdminAction?(requestId: string, tx?: StoreTx): Promise<void>;
    /** 该设备指纹下已注册的账号数(按 `registerMeta.fingerprint`;PG:jsonb `->> 'fingerprint'`,建表达式索引) */
    countByRegisterFingerprint?(fingerprint: string, tx?: StoreTx): Promise<number>;
    /** 只读取一个码(预检给用户一句能看懂的错;真正的扣减在 consumeBetaCode) */
    findBetaCode?(code: string, tx?: StoreTx): Promise<BetaCodeRecord | null>;
    /**
     * **原子**扣一次:判断与扣减是同一条 UPDATE
     * (`... set used_count = used_count + 1 where code = ? and enabled and (max_uses is null or used_count < max_uses)
     *   and (expires_at is null or expires_at > now()) returning ...`),受影响行数即答案。
     * 「读 → 内存 +1 → 整行写回」在并发下必丢计数、maxUses 形同虚设。必须能带 tx:与建号同事务,建号失败码不白扣。
     */
    consumeBetaCode?(code: string, tx?: StoreTx): Promise<boolean>;
    /** 批量登记;`on conflict (code) do nothing returning` —— 返回的就是**真正新建的**,没返回的即已存在。重放整批只会得到空数组 */
    insertBetaCodes?(rows: BetaCodeInsert[], createdBy: string | null, tx?: StoreTx): Promise<BetaCodeRecord[]>;
    updateBetaCode?(id: string, patch: BetaCodePatch, tx?: StoreTx): Promise<BetaCodeRecord | null>;
    /** id 降序 keyset */
    listBetaCodes?(filter: BetaCodeListFilter, tx?: StoreTx): Promise<BetaCodeRecord[]>;
    /**
     * 在建号事务里原子占一个当日名额:`insert into zh_registration_days(day_key, used) values (?, 1)
     *   on conflict (day_key) do update set used = zh_registration_days.used + 1 where zh_registration_days.used < ? returning used`。
     * 放 DB 不放 KV 的理由:占位与建号**同一事务**,建号任何一步失败(用户名撞了 / afterCreate 抛)事务回滚,
     * 名额自动归还 —— KV 计数要么先扣后补偿(补偿路径漏一条名额就永远少一格),要么后扣不原子(并发多放人)。
     * false = 满了(调用方抛 REGISTRATION_FULL,整个注册回滚)。
     */
    reserveDailySlot?(dayKey: string, limit: number, tx?: StoreTx): Promise<boolean>;
    /** 当日已占用数(展示用,**不能拿来判成功**,判成功只认 reserveDailySlot 的返回) */
    dailyUsed?(dayKey: string, tx?: StoreTx): Promise<number>;
}
/** search 的结构化条件:由 service 从 AdminSearchQuery.query 解析而来 */
export interface SearchFilter {
    /** 纯数字串:同时按 userId 精确与手机号包含 */
    userId?: string;
    phoneContains?: string;
    /** 非数字串:用户名 / 昵称 / 邮箱 ILIKE %q% */
    textContains?: string;
    role?: UserRole;
    status?: UserStatus;
    createdFrom?: Date;
    createdTo?: Date;
    beforeUserId?: string;
    limit: number;
}
export type { AdminSearchQuery };