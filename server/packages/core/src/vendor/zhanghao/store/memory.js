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
/** userId 是数字串,按数值比大小(字符串比会让 "10" 排在 "9" 前面) */
function numOf(id) {
    try {
        return BigInt(id);
    }
    catch {
        return -1n;
    }
}
function descByNum(a, b) {
    const x = numOf(a);
    const y = numOf(b);
    return y < x ? -1 : y > x ? 1 : 0;
}
export class MemoryZhanghaoStore {
    /** userId 到行 */
    users = new Map();
    /** userId 到密码哈希(与行分开存:公开投影路径结构上碰不到它) */
    hashes = new Map();
    actions = [];
    /** 注册管控:内测码(按 id)与每日名额(按 dayKey) */
    betaCodes = new Map();
    days = new Map();
    #userSeq = 0n;
    #actionSeq = 0n;
    #betaSeq = 0n;
    #now;
    constructor(opts = {}) {
        this.#now = opts.now ?? (() => new Date());
    }
    /* 读 */
    async findById(userId, _tx) {
        return this.#clone(this.users.get(userId));
    }
    /* 用户名与 PG 参考实现一样按 lower() 比较:`Alice` 与 `alice` 是同一个号,登录与唯一性都如此 */
    async findByUsername(username, _tx) {
        const key = username.toLowerCase();
        return this.#clone([...this.users.values()].find((u) => u.username.toLowerCase() === key));
    }
    async findByPhone(phone, _tx) {
        return this.#clone([...this.users.values()].find((u) => u.phone === phone));
    }
    /* 邮箱同样按 lower() 比较(PG 唯一索引建在 lower(email) 上) */
    async findByEmail(email, _tx) {
        const key = email.toLowerCase();
        return this.#clone([...this.users.values()].find((u) => u.email !== null && u.email.toLowerCase() === key));
    }
    async findForLogin(identifier, _tx) {
        const found = identifier.kind === "username"
            ? await this.findByUsername(identifier.value)
            : identifier.kind === "phone"
                ? await this.findByPhone(identifier.value)
                : await this.findByEmail(identifier.value);
        if (!found)
            return null;
        const passwordHash = this.hashes.get(found.userId);
        if (passwordHash === undefined)
            return null;
        return { user: found, passwordHash };
    }
    /* 昵称与 PG 参考实现一样按 lower() 等值;至多 limit 条,「恰好一个」由 service 判 */
    async findManyForLoginByNickname(nickname, limit, _tx) {
        const key = nickname.toLowerCase();
        const out = [];
        for (const u of this.users.values()) {
            if (out.length >= limit)
                break;
            if (u.nickname === null || u.nickname.toLowerCase() !== key)
                continue;
            const passwordHash = this.hashes.get(u.userId);
            if (passwordHash === undefined)
                continue;
            out.push({ user: this.#clone(u), passwordHash });
        }
        return out;
    }
    async passwordHashOf(userId, _tx) {
        return this.hashes.get(userId) ?? null;
    }
    async search(filter, _tx) {
        const text = filter.textContains?.toLowerCase();
        const rows = [...this.users.values()]
            .filter((u) => {
            // userId 与 phoneContains 是「或」:运营手里那串数字可能是编号也可能是号码片段
            if (filter.userId !== undefined || filter.phoneContains !== undefined) {
                const byId = filter.userId !== undefined && u.userId === filter.userId;
                const byPhone = filter.phoneContains !== undefined && (u.phone ?? "").includes(filter.phoneContains);
                if (!byId && !byPhone)
                    return false;
            }
            if (text !== undefined) {
                const hay = [u.username, u.nickname ?? "", u.email ?? ""].join(" ").toLowerCase();
                if (!hay.includes(text))
                    return false;
            }
            if (filter.role && u.role !== filter.role)
                return false;
            if (filter.status && u.status !== filter.status)
                return false;
            if (filter.createdFrom && u.createdAt < filter.createdFrom)
                return false;
            if (filter.createdTo && u.createdAt > filter.createdTo)
                return false;
            if (filter.beforeUserId !== undefined && numOf(u.userId) >= numOf(filter.beforeUserId))
                return false;
            return true;
        })
            .sort((a, b) => descByNum(a.userId, b.userId));
        return rows.slice(0, filter.limit).map((u) => ({ ...u }));
    }
    async findManyByIds(userIds, _tx) {
        const out = [];
        for (const id of new Set(userIds)) {
            const u = this.users.get(id);
            if (u)
                out.push({ ...u });
        }
        return out;
    }
    /* 写 */
    async insertUserIfAbsent(data, _tx) {
        const conflict = this.#conflictOf(null, {
            username: data.username,
            phone: data.phone,
            email: data.email,
        });
        if (conflict)
            return { ok: false, conflict };
        this.#userSeq += 1n;
        const now = this.#now();
        const user = {
            userId: String(this.#userSeq),
            username: data.username,
            phone: data.phone,
            email: data.email,
            nickname: data.nickname,
            avatarKey: data.avatarKey,
            role: data.role,
            status: "active",
            bannedUntil: null,
            bannedReason: null,
            registerMeta: data.registerMeta,
            createdAt: now,
            updatedAt: now,
        };
        this.users.set(user.userId, user);
        this.hashes.set(user.userId, data.passwordHash);
        return { ok: true, user: { ...user } };
    }
    async updatePasswordHash(userId, passwordHash, _tx) {
        if (!this.users.has(userId))
            return;
        this.hashes.set(userId, passwordHash);
        this.#touch(userId);
    }
    async updateIdentifierIfFree(userId, field, value, _tx) {
        const user = this.users.get(userId);
        if (!user)
            return false;
        if (field === "username" && value === null)
            return false; // username 不许为空,service 也挡一道
        const next = {};
        next[field] = value;
        if (this.#conflictOf(userId, next))
            return false;
        if (field === "username")
            user.username = value;
        else if (field === "phone")
            user.phone = value;
        else
            user.email = value;
        this.#touch(userId);
        return true;
    }
    async updateProfile(userId, patch, _tx) {
        const user = this.users.get(userId);
        if (!user)
            return;
        if ("nickname" in patch)
            user.nickname = patch.nickname ?? null;
        if ("avatarKey" in patch)
            user.avatarKey = patch.avatarKey ?? null;
        if (patch.status !== undefined)
            user.status = patch.status;
        if ("bannedUntil" in patch)
            user.bannedUntil = patch.bannedUntil ?? null;
        if ("bannedReason" in patch)
            user.bannedReason = patch.bannedReason ?? null;
        this.#touch(userId);
    }
    /* 后台审计 */
    async insertAdminActionIfAbsent(data, _tx) {
        if (this.actions.some((a) => a.requestId === data.requestId))
            return null; // 模拟 requestId 唯一约束
        this.#actionSeq += 1n;
        const rec = {
            id: String(this.#actionSeq),
            requestId: data.requestId,
            operatorId: data.operatorId,
            targetUserId: data.targetUserId,
            action: data.action,
            detail: data.detail,
            createdAt: this.#now(),
        };
        this.actions.push(rec);
        return { ...rec };
    }
    async releaseAdminAction(requestId, _tx) {
        const i = this.actions.findIndex((a) => a.requestId === requestId);
        if (i >= 0)
            this.actions.splice(i, 1);
    }
    async findAdminActionByRequestId(requestId, _tx) {
        const found = this.actions.find((a) => a.requestId === requestId);
        return found ? { ...found } : null;
    }
    async listAdminActions(targetUserId, opts, _tx) {
        return this.actions
            .filter((a) => a.targetUserId === targetUserId && (opts.beforeId === undefined || numOf(a.id) < numOf(opts.beforeId)))
            .sort((a, b) => descByNum(a.id, b.id))
            .slice(0, opts.limit)
            .map((a) => ({ ...a }));
    }
    /* 注册管控(可选方法,内存版全实现;PG 参考实现的原子性在这里表现为同步执行) */
    async countByRegisterFingerprint(fingerprint, _tx) {
        let n = 0;
        for (const u of this.users.values())
            if (u.registerMeta?.fingerprint === fingerprint)
                n += 1;
        return n;
    }
    async findBetaCode(code, _tx) {
        const found = [...this.betaCodes.values()].find((b) => b.code === code);
        return found ? { ...found } : null;
    }
    /** 与 PG 那条 UPDATE 同一判据:启用 且 未过期 且 未用尽,三者同时成立才 +1 */
    async consumeBetaCode(code, _tx) {
        const row = [...this.betaCodes.values()].find((b) => b.code === code);
        if (!row)
            return false;
        const now = this.#now().getTime();
        if (!row.enabled)
            return false;
        if (row.expiresAt !== null && row.expiresAt.getTime() <= now)
            return false;
        if (row.maxUses !== null && row.usedCount >= row.maxUses)
            return false;
        row.usedCount += 1;
        return true;
    }
    /** 模拟 `on conflict (code) do nothing returning`:已存在的码不返回 */
    async insertBetaCodes(rows, createdBy, _tx) {
        const created = [];
        for (const r of rows) {
            if ([...this.betaCodes.values()].some((b) => b.code === r.code))
                continue;
            this.#betaSeq += 1n;
            const rec = {
                id: String(this.#betaSeq),
                code: r.code,
                note: r.note,
                maxUses: r.maxUses,
                usedCount: 0,
                enabled: true,
                expiresAt: r.expiresAt,
                createdBy,
                createdAt: this.#now(),
            };
            this.betaCodes.set(rec.id, rec);
            created.push({ ...rec });
        }
        return created;
    }
    async updateBetaCode(id, patch, _tx) {
        const row = this.betaCodes.get(id);
        if (!row)
            return null;
        if (patch.note !== undefined)
            row.note = patch.note;
        if (patch.maxUses !== undefined)
            row.maxUses = patch.maxUses;
        if (patch.enabled !== undefined)
            row.enabled = patch.enabled;
        if (patch.expiresAt !== undefined)
            row.expiresAt = patch.expiresAt;
        return { ...row };
    }
    async listBetaCodes(filter, _tx) {
        const now = this.#now().getTime();
        const usable = (b) => b.enabled && (b.expiresAt === null || b.expiresAt.getTime() > now) && (b.maxUses === null || b.usedCount < b.maxUses);
        const q = filter.query?.toUpperCase();
        return [...this.betaCodes.values()]
            .filter((b) => {
            if (q && !b.code.startsWith(q))
                return false;
            if (filter.status === "usable" && !usable(b))
                return false;
            if (filter.status === "unusable" && usable(b))
                return false;
            if (filter.beforeId !== undefined && numOf(b.id) >= numOf(filter.beforeId))
                return false;
            return true;
        })
            .sort((a, b) => descByNum(a.id, b.id))
            .slice(0, filter.limit)
            .map((b) => ({ ...b }));
    }
    /** 模拟 `insert … on conflict do update set used = used + 1 where used < limit returning` */
    async reserveDailySlot(dayKey, limit, _tx) {
        const used = this.days.get(dayKey) ?? 0;
        if (used >= limit)
            return false;
        this.days.set(dayKey, used + 1);
        return true;
    }
    async dailyUsed(dayKey, _tx) {
        return this.days.get(dayKey) ?? 0;
    }
    /* 内部 */
    /** 模拟三个部分唯一索引:null 不参与约束(PG 的唯一索引同样不约束 NULL) */
    #conflictOf(selfId, next) {
        for (const key of Object.keys(next)) {
            const value = next[key];
            if (value === null || value === undefined)
                continue;
            for (const u of this.users.values()) {
                if (selfId !== null && u.userId === selfId)
                    continue;
                const cur = key === "username" ? u.username : key === "phone" ? u.phone : u.email;
                if (cur === null)
                    continue;
                // username / email 大小写不敏感(PG 侧唯一索引建在 lower() 上),phone 已是纯数字
                const same = key === "phone" ? cur === value : cur.toLowerCase() === value.toLowerCase();
                if (same)
                    return key;
            }
        }
        return null;
    }
    #touch(userId) {
        const u = this.users.get(userId);
        if (u)
            u.updatedAt = this.#now();
    }
    #clone(u) {
        return u ? { ...u } : null;
    }
}
