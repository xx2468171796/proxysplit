/**
 * 内存版 ZhanghaoStore —— 测试与演示用,语义与 PG 参考实现对齐。
 *
 * 三处刻意模拟数据库约束而不是「先查再写」:
 *   - insertUserIfAbsent 撞 username/phone/email 返回 {ok:false, conflict}
 *   - updateIdentifierIfFree 撞唯一返回 false
 *   - insertAdminActionIfAbsent 撞 requestId 返回 null
 * 单进程内没有真并发,所以这里的「原子」表现为同步执行;换到 PG 上必须由唯一索引兜住。
 *
 * **不要在生产用它**:进程一重启全没了,且多 worker 各有一份。
 */
import type { AdminActionRecord, BetaCodeRecord, UserRecord } from "../types.ts";
import type { BetaCodeInsert, BetaCodeListFilter, BetaCodePatch, InsertAdminActionData, InsertUserData, InsertUserResult, SearchFilter, StoreTx, UniqueField, UserPatch, ZhanghaoStore } from "./types.ts";
export declare class MemoryZhanghaoStore implements ZhanghaoStore {
    #private;
    /** userId 到行 */
    readonly users: Map<string, UserRecord>;
    /** userId 到密码哈希(与行分开存:公开投影路径结构上碰不到它) */
    readonly hashes: Map<string, string>;
    readonly actions: AdminActionRecord[];
    /** 注册管控:内测码(按 id)与每日名额(按 dayKey) */
    readonly betaCodes: Map<string, BetaCodeRecord>;
    readonly days: Map<string, number>;
    constructor(opts?: {
        now?: () => Date;
    });
    findById(userId: string, _tx?: StoreTx): Promise<UserRecord | null>;
    findByUsername(username: string, _tx?: StoreTx): Promise<UserRecord | null>;
    findByPhone(phone: string, _tx?: StoreTx): Promise<UserRecord | null>;
    findByEmail(email: string, _tx?: StoreTx): Promise<UserRecord | null>;
    findForLogin(identifier: {
        kind: UniqueField;
        value: string;
    }, _tx?: StoreTx): Promise<{
        user: UserRecord;
        passwordHash: string;
    } | null>;
    findManyForLoginByNickname(nickname: string, limit: number, _tx?: StoreTx): Promise<Array<{
        user: UserRecord;
        passwordHash: string;
    }>>;
    passwordHashOf(userId: string, _tx?: StoreTx): Promise<string | null>;
    search(filter: SearchFilter, _tx?: StoreTx): Promise<UserRecord[]>;
    findManyByIds(userIds: string[], _tx?: StoreTx): Promise<UserRecord[]>;
    insertUserIfAbsent(data: InsertUserData, _tx?: StoreTx): Promise<InsertUserResult>;
    updatePasswordHash(userId: string, passwordHash: string, _tx?: StoreTx): Promise<void>;
    updateIdentifierIfFree(userId: string, field: UniqueField, value: string | null, _tx?: StoreTx): Promise<boolean>;
    updateProfile(userId: string, patch: UserPatch, _tx?: StoreTx): Promise<void>;
    insertAdminActionIfAbsent(data: InsertAdminActionData, _tx?: StoreTx): Promise<AdminActionRecord | null>;
    releaseAdminAction(requestId: string, _tx?: StoreTx): Promise<void>;
    findAdminActionByRequestId(requestId: string, _tx?: StoreTx): Promise<AdminActionRecord | null>;
    listAdminActions(targetUserId: string, opts: {
        beforeId?: string;
        limit: number;
    }, _tx?: StoreTx): Promise<AdminActionRecord[]>;
    countByRegisterFingerprint(fingerprint: string, _tx?: StoreTx): Promise<number>;
    findBetaCode(code: string, _tx?: StoreTx): Promise<BetaCodeRecord | null>;
    /** 与 PG 那条 UPDATE 同一判据:启用 且 未过期 且 未用尽,三者同时成立才 +1 */
    consumeBetaCode(code: string, _tx?: StoreTx): Promise<boolean>;
    /** 模拟 `on conflict (code) do nothing returning`:已存在的码不返回 */
    insertBetaCodes(rows: BetaCodeInsert[], createdBy: string | null, _tx?: StoreTx): Promise<BetaCodeRecord[]>;
    updateBetaCode(id: string, patch: BetaCodePatch, _tx?: StoreTx): Promise<BetaCodeRecord | null>;
    listBetaCodes(filter: BetaCodeListFilter, _tx?: StoreTx): Promise<BetaCodeRecord[]>;
    /** 模拟 `insert … on conflict do update set used = used + 1 where used < limit returning` */
    reserveDailySlot(dayKey: string, limit: number, _tx?: StoreTx): Promise<boolean>;
    dailyUsed(dayKey: string, _tx?: StoreTx): Promise<number>;
}