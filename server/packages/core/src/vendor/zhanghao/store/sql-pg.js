/**
 * 通用 PostgreSQL 参考实现:**不绑 ORM**,只要宿主能给一个 `query(text, params)`
 * (node-postgres 的 Pool/Client、postgres.js 包一层、Prisma 的 `$queryRawUnsafe` 包一层都行)。
 * Drizzle 宿主用 store/drizzle-pg;其余 PG 宿主用这个,省得自己实现 15 个方法。
 *
 * 与 drizzle 版同样的三条不能先查后写(理由见 store/drizzle-pg.ts 头注释):
 *   insertUserIfAbsent / updateIdentifierIfFree / insertAdminActionIfAbsent
 * 分别靠 `on conflict do nothing returning` 与 23505 捕获吃并发。
 *
 * 用户 id 列既可以是 text 也可以是 bigint:出入参都是字符串,PG 会按列类型自己转
 * (所以多数宿主不用传 userIdCodec;列型特殊时才传)。
 * `tx` 传一个同样有 `query` 的事务句柄(pg 的 PoolClient 在 BEGIN 之后),传了就用它。
 *
 * 表名可改(`tableNames`),列名**不可改**(与 sql/schema.sql 一致)。
 * 所有用户输入一律走 $n 参数,SQL 文本里只拼**校验过的表名**。
 */
import { LIKE_ESCAPE, likeContains, likePrefix } from "./like.js";
const DEFAULT_TABLES = { users: "zh_users", adminActions: "zh_admin_actions", betaCodes: "zh_beta_codes", registrationDays: "zh_registration_days" };
const IDENTITY_CODEC = {
    toDb: (userId) => userId,
    fromDb: (value) => String(value),
};
/** 只允许安全的表名(表名不能参数化,只能白名单式校验后拼进 SQL) */
function assertIdent(name) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(name))
        throw new Error(`非法表名: ${name}`);
    return name;
}
function toDate(value) {
    return value instanceof Date ? value : new Date(String(value));
}
/** PG unique_violation;drizzle/驱动可能包几层,顺 cause 链找。其它错误照抛。 */
function isUniqueViolation(err) {
    let cur = err;
    for (let depth = 0; cur && depth < 5; depth += 1) {
        if (cur.code === "23505")
            return true;
        cur = cur.cause;
    }
    return false;
}
const USER_COLS = "id, username, password_hash, phone, email, nickname, avatar_key, role, status, banned_until, banned_reason, register_meta, created_at, updated_at";
const BETA_COLS = "id, code, note, max_uses, used_count, enabled, expires_at, created_by, created_at";
/** 「可用」= 启用 且 未过期 且 未用尽;consume 的 where 与 list 的筛选共用这一句 */
const BETA_USABLE = "enabled and (expires_at is null or expires_at > now()) and (max_uses is null or used_count < max_uses)";
/** 建 store 时算好、各组方法共用的东西(原来都是 createSqlPgZhanghaoStore 的闭包变量) */
function makeCtx(options) {
    const T = {
        users: assertIdent(options.tableNames?.users ?? DEFAULT_TABLES.users),
        adminActions: assertIdent(options.tableNames?.adminActions ?? DEFAULT_TABLES.adminActions),
        betaCodes: assertIdent(options.tableNames?.betaCodes ?? DEFAULT_TABLES.betaCodes),
        registrationDays: assertIdent(options.tableNames?.registrationDays ?? DEFAULT_TABLES.registrationDays),
    };
    const codec = options.userIdCodec ?? IDENTITY_CODEC;
    const root = { query: options.query };
    const ex = (tx) => tx && typeof tx.query === "function" ? tx : root;
    const mapUser = (r) => ({
        userId: codec.fromDb(r.id),
        username: String(r.username),
        phone: r.phone == null ? null : String(r.phone),
        email: r.email == null ? null : String(r.email),
        nickname: r.nickname == null ? null : String(r.nickname),
        avatarKey: r.avatar_key == null ? null : String(r.avatar_key),
        role: r.role,
        status: r.status,
        bannedUntil: r.banned_until == null ? null : toDate(r.banned_until),
        bannedReason: r.banned_reason == null ? null : String(r.banned_reason),
        registerMeta: r.register_meta == null
            ? null
            : (typeof r.register_meta === "string" ? JSON.parse(r.register_meta) : r.register_meta),
        createdAt: toDate(r.created_at),
        updatedAt: toDate(r.updated_at),
    });
    const mapAction = (r) => ({
        id: String(r.id),
        requestId: String(r.request_id),
        operatorId: codec.fromDb(r.operator_id),
        targetUserId: codec.fromDb(r.target_user_id),
        action: r.action,
        detail: String(r.detail),
        createdAt: toDate(r.created_at),
    });
    const mapBeta = (r) => ({
        id: String(r.id),
        code: String(r.code),
        note: r.note == null ? "" : String(r.note),
        maxUses: r.max_uses == null ? null : Number(r.max_uses),
        usedCount: Number(r.used_count ?? 0),
        enabled: Boolean(r.enabled),
        expiresAt: r.expires_at == null ? null : toDate(r.expires_at),
        createdBy: r.created_by == null ? null : codec.fromDb(r.created_by),
        createdAt: toDate(r.created_at),
    });
    async function firstUser(where, params, tx) {
        const { rows } = await ex(tx).query(`select ${USER_COLS} from ${T.users} where ${where} limit 1`, params);
        return rows[0] ? mapUser(rows[0]) : null;
    }
    /** 与唯一索引同口径:username 与 email 都是 lower() 比 */
    const byUsername = (v, tx) => firstUser("lower(username) = lower($1)", [v], tx);
    const byEmail = (v, tx) => firstUser("lower(email) = lower($1)", [v], tx);
    const byPhone = (v, tx) => firstUser("phone = $1", [v], tx);
    return { T, codec, ex, mapUser, mapAction, mapBeta, firstUser, byUsername, byEmail, byPhone };
}
/* 下面几组方法原来写在 createSqlPgZhanghaoStore 返回的一个对象字面量里,按原顺序拆开只为把工厂拆短;SQL 文本一字未改 */
function userReads(c) {
    const { T, codec, ex, mapUser, firstUser, byUsername, byEmail, byPhone } = c;
    return {
        /* ────────── 读 ────────── */
        async findById(userId, tx) {
            return firstUser("id = $1", [codec.toDb(userId)], tx);
        },
        async findByUsername(username, tx) {
            return byUsername(username, tx);
        },
        async findByPhone(phone, tx) {
            return byPhone(phone, tx);
        },
        async findByEmail(email, tx) {
            return byEmail(email, tx);
        },
        async findForLogin(identifier, tx) {
            const where = identifier.kind === "username"
                ? "lower(username) = lower($1)"
                : identifier.kind === "email"
                    ? "lower(email) = lower($1)"
                    : "phone = $1";
            const { rows } = await ex(tx).query(`select ${USER_COLS} from ${T.users} where ${where} limit 1`, [identifier.value]);
            if (!rows[0])
                return null;
            return { user: mapUser(rows[0]), passwordHash: String(rows[0].password_hash) };
        },
        async findManyForLoginByNickname(nickname, limit, tx) {
            const { rows } = await ex(tx).query(`select ${USER_COLS} from ${T.users} where lower(nickname) = lower($1) limit $2`, [nickname, limit]);
            return rows.map((r) => ({ user: mapUser(r), passwordHash: String(r.password_hash) }));
        },
        async passwordHashOf(userId, tx) {
            const { rows } = await ex(tx).query(`select password_hash from ${T.users} where id = $1 limit 1`, [codec.toDb(userId)]);
            return rows[0] ? String(rows[0].password_hash) : null;
        },
    };
}
function userLists(c) {
    const { T, codec, ex, mapUser } = c;
    return {
        async search(filter, tx) {
            const params = [];
            const conds = [];
            const p = (v) => {
                params.push(v);
                return `$${params.length}`;
            };
            // 纯数字串:userId 精确 OR 手机号包含 —— 一个搜索框两种解释
            const idOrPhone = [];
            if (filter.userId !== undefined)
                idOrPhone.push(`id = ${p(codec.toDb(filter.userId))}`);
            if (filter.phoneContains !== undefined)
                idOrPhone.push(`phone ilike ${p(likeContains(filter.phoneContains))} ${LIKE_ESCAPE}`);
            // length === 1 时 [0] 必有;原来的 `!` 只骗类型,这里同样只做类型断言
            if (idOrPhone.length === 1)
                conds.push(idOrPhone[0]);
            else if (idOrPhone.length > 1)
                conds.push(`(${idOrPhone.join(" or ")})`);
            if (filter.textContains !== undefined) {
                const ph = p(likeContains(filter.textContains));
                conds.push(`(username ilike ${ph} ${LIKE_ESCAPE} or nickname ilike ${ph} ${LIKE_ESCAPE} or email ilike ${ph} ${LIKE_ESCAPE})`);
            }
            if (filter.role !== undefined)
                conds.push(`role = ${p(filter.role)}`);
            if (filter.status !== undefined)
                conds.push(`status = ${p(filter.status)}`);
            if (filter.createdFrom !== undefined)
                conds.push(`created_at >= ${p(filter.createdFrom)}`);
            if (filter.createdTo !== undefined)
                conds.push(`created_at <= ${p(filter.createdTo)}`);
            // keyset:降序翻旧页
            if (filter.beforeUserId !== undefined)
                conds.push(`id < ${p(codec.toDb(filter.beforeUserId))}`);
            const where = conds.length ? `where ${conds.join(" and ")}` : "";
            const { rows } = await ex(tx).query(`select ${USER_COLS} from ${T.users} ${where} order by id desc limit ${p(filter.limit)}`, params);
            return rows.map(mapUser);
        },
        async findManyByIds(userIds, tx) {
            if (userIds.length === 0)
                return [];
            // = any($1) 比展开 IN ($1,$2,...) 稳:参数个数固定,不会被超长列表打爆
            const { rows } = await ex(tx).query(`select ${USER_COLS} from ${T.users} where id = any($1) order by id asc`, [userIds.map((id) => codec.toDb(id))]);
            return rows.map(mapUser);
        },
    };
}
function userWrites(c) {
    const { T, codec, ex, mapUser, byUsername, byEmail, byPhone } = c;
    return {
        /* ────────── 写 ────────── */
        async insertUserIfAbsent(data, tx) {
            const { rows } = await ex(tx).query(`insert into ${T.users} (username, password_hash, phone, email, nickname, avatar_key, role, register_meta)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict do nothing
         returning ${USER_COLS}`, [
                data.username,
                data.passwordHash,
                data.phone,
                data.email,
                data.nickname,
                data.avatarKey,
                data.role,
                data.registerMeta == null ? null : JSON.stringify(data.registerMeta),
            ]);
            if (rows[0])
                return { ok: true, user: mapUser(rows[0]) };
            // 插不进去 = 三个唯一索引里撞了一个。**先插后查**:这次查只为报出「是哪个字段」,
            // 能不能插已经由数据库判完了(先查再插在并发下会放进两个同名号)。
            if (await byUsername(data.username, tx))
                return { ok: false, conflict: "username" };
            if (data.phone != null && (await byPhone(data.phone, tx)))
                return { ok: false, conflict: "phone" };
            if (data.email != null && (await byEmail(data.email, tx)))
                return { ok: false, conflict: "email" };
            // 冲突方在我们查之前被删了:报冲突让调用方重试,绝不静默成功
            return { ok: false, conflict: "username" };
        },
        async updatePasswordHash(userId, passwordHash, tx) {
            await ex(tx).query(`update ${T.users} set password_hash = $2, updated_at = now() where id = $1`, [
                codec.toDb(userId),
                passwordHash,
            ]);
        },
        async updateIdentifierIfFree(userId, field, value, tx) {
            // field 来自联合类型,不是自由文本;仍显式白名单一次,防将来被当通用入口误用
            const column = field === "username" ? "username" : field === "phone" ? "phone" : "email";
            try {
                const { rows } = await ex(tx).query(`update ${T.users} set ${column} = $2, updated_at = now() where id = $1 returning id`, [codec.toDb(userId), value]);
                return rows.length > 0;
            }
            catch (err) {
                if (isUniqueViolation(err))
                    return false;
                throw err;
            }
        },
        async updateProfile(userId, patch, tx) {
            const params = [codec.toDb(userId)];
            const sets = ["updated_at = now()"];
            const put = (col, v) => {
                params.push(v);
                sets.push(`${col} = $${params.length}`);
            };
            // undefined = 不动,null = 真的清空
            if (patch.nickname !== undefined)
                put("nickname", patch.nickname);
            if (patch.avatarKey !== undefined)
                put("avatar_key", patch.avatarKey);
            if (patch.status !== undefined)
                put("status", patch.status);
            if (patch.bannedUntil !== undefined)
                put("banned_until", patch.bannedUntil);
            if (patch.bannedReason !== undefined)
                put("banned_reason", patch.bannedReason);
            await ex(tx).query(`update ${T.users} set ${sets.join(", ")} where id = $1`, params);
        },
    };
}
function auditMethods(c) {
    const { T, codec, ex, mapAction } = c;
    return {
        /* ────────── 后台审计 ────────── */
        async insertAdminActionIfAbsent(data, tx) {
            const { rows } = await ex(tx).query(`insert into ${T.adminActions} (request_id, operator_id, target_user_id, action, detail)
         values ($1, $2, $3, $4, $5)
         on conflict do nothing
         returning id, request_id, operator_id, target_user_id, action, detail, created_at`, [data.requestId, codec.toDb(data.operatorId), codec.toDb(data.targetUserId), data.action, data.detail]);
            // null = 这个 requestId 已执行过 → service 回放,不二次生效
            return rows[0] ? mapAction(rows[0]) : null;
        },
        async releaseAdminAction(requestId, tx) {
            await ex(tx).query(`delete from ${T.adminActions} where request_id = $1`, [requestId]);
        },
        async findAdminActionByRequestId(requestId, tx) {
            const { rows } = await ex(tx).query(`select id, request_id, operator_id, target_user_id, action, detail, created_at
         from ${T.adminActions} where request_id = $1 limit 1`, [requestId]);
            return rows[0] ? mapAction(rows[0]) : null;
        },
        async listAdminActions(targetUserId, opts, tx) {
            const params = [codec.toDb(targetUserId)];
            let where = "target_user_id = $1";
            if (opts.beforeId !== undefined) {
                params.push(opts.beforeId);
                where += ` and id < $${params.length}`;
            }
            params.push(opts.limit);
            const { rows } = await ex(tx).query(`select id, request_id, operator_id, target_user_id, action, detail, created_at
         from ${T.adminActions} where ${where} order by id desc limit $${params.length}`, params);
            return rows.map(mapAction);
        },
    };
}
function registrationReads(c) {
    const { T, ex, mapBeta } = c;
    return {
        /* ────────── 注册管控 ────────── */
        async countByRegisterFingerprint(fingerprint, tx) {
            // 走表达式索引 zh_users_register_fingerprint_idx((register_meta ->> 'fingerprint'))
            const { rows } = await ex(tx).query(`select count(*)::int as n from ${T.users} where register_meta ->> 'fingerprint' = $1`, [fingerprint]);
            return Number(rows[0]?.n ?? 0);
        },
        async findBetaCode(code, tx) {
            const { rows } = await ex(tx).query(`select ${BETA_COLS} from ${T.betaCodes} where code = $1 limit 1`, [code]);
            return rows[0] ? mapBeta(rows[0]) : null;
        },
        // 判断与扣减同一条 UPDATE:受影响行数为 0 = 不存在 / 停用 / 过期 / 用完;并发下绝不超发
        async consumeBetaCode(code, tx) {
            const { rows } = await ex(tx).query(`update ${T.betaCodes} set used_count = used_count + 1, updated_at = now()
          where code = $1 and ${BETA_USABLE}
          returning id`, [code]);
            return rows.length > 0;
        },
    };
}
function registrationWrites(c) {
    const { T, codec, ex, mapBeta } = c;
    return {
        // on conflict do nothing + returning:返回的就是真正新建的;重放整批得到空数组
        async insertBetaCodes(rows, createdBy, tx) {
            if (rows.length === 0)
                return [];
            const params = [];
            const tuples = rows.map((r) => {
                params.push(r.code, r.note, r.maxUses, r.expiresAt, createdBy === null ? null : codec.toDb(createdBy));
                const n = params.length;
                return `($${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
            });
            const res = await ex(tx).query(`insert into ${T.betaCodes} (code, note, max_uses, expires_at, created_by) values ${tuples.join(", ")}
         on conflict (code) do nothing
         returning ${BETA_COLS}`, params);
            return res.rows.map(mapBeta);
        },
        async updateBetaCode(id, patch, tx) {
            const params = [id];
            const sets = ["updated_at = now()"];
            const put = (col, v) => {
                params.push(v);
                sets.push(`${col} = $${params.length}`);
            };
            if (patch.note !== undefined)
                put("note", patch.note);
            if (patch.maxUses !== undefined)
                put("max_uses", patch.maxUses);
            if (patch.enabled !== undefined)
                put("enabled", patch.enabled);
            if (patch.expiresAt !== undefined)
                put("expires_at", patch.expiresAt);
            const { rows } = await ex(tx).query(`update ${T.betaCodes} set ${sets.join(", ")} where id = $1 returning ${BETA_COLS}`, params);
            return rows[0] ? mapBeta(rows[0]) : null;
        },
        async listBetaCodes(filter, tx) {
            const params = [];
            const conds = [];
            const p = (v) => {
                params.push(v);
                return `$${params.length}`;
            };
            if (filter.query)
                conds.push(`code ilike ${p(likePrefix(filter.query.toUpperCase()))} ${LIKE_ESCAPE}`);
            if (filter.status === "usable")
                conds.push(`(${BETA_USABLE})`);
            if (filter.status === "unusable")
                conds.push(`not (${BETA_USABLE})`);
            if (filter.beforeId !== undefined)
                conds.push(`id < ${p(filter.beforeId)}`);
            const where = conds.length ? `where ${conds.join(" and ")}` : "";
            const { rows } = await ex(tx).query(`select ${BETA_COLS} from ${T.betaCodes} ${where} order by id desc limit ${p(filter.limit)}`, params);
            return rows.map(mapBeta);
        },
        // 一条 upsert 同时完成「建当日行」与「有上限地 +1」;没返回行 = 满了;在事务里回滚即归还
        async reserveDailySlot(dayKey, limit, tx) {
            const { rows } = await ex(tx).query(`insert into ${T.registrationDays} (day_key, used) values ($1, 1)
         on conflict (day_key) do update set used = ${T.registrationDays}.used + 1, updated_at = now()
         where ${T.registrationDays}.used < $2
         returning used`, [dayKey, limit]);
            return rows.length > 0;
        },
        async dailyUsed(dayKey, tx) {
            const { rows } = await ex(tx).query(`select used from ${T.registrationDays} where day_key = $1 limit 1`, [dayKey]);
            return Number(rows[0]?.used ?? 0);
        },
    };
}
export function createSqlPgZhanghaoStore(options) {
    const c = makeCtx(options);
    return {
        ...userReads(c),
        ...userLists(c),
        ...userWrites(c),
        ...auditMethods(c),
        ...registrationReads(c),
        ...registrationWrites(c),
    };
}
