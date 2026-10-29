/**
 * 通用 PostgreSQL store —— **不绑 ORM**。宿主给一个 `query(text, values) → { rows }`:
 *   - node-postgres:`{ query: (t, v) => pool.query(t, v) }`
 *   - postgres.js  :`{ query: async (t, v) => ({ rows: await sql.unsafe(t, v as never[]) }) }`
 *   - Prisma       :`{ query: async (t, v) => ({ rows: await prisma.$queryRawUnsafe(t, ...(v ?? [])) }) }`
 *   - Drizzle      :拿它底下的驱动(pg Pool / postgres.js 实例)按上面包
 *
 * 数组参数一律以 PG 字面量字符串 + `::text[]` 传(pgArrayLiteral),不依赖驱动的数组序列化 —— Prisma 的 raw 对
 * JS 数组的处理在不同版本间不稳定,踩过。jsonb 参数以字符串 + `::jsonb` 传,同理。
 *
 * 表名可改(tables),列名不可改(与 sql/schema.sql 一致)。用户 id 列 text;bigint 主键宿主出入参都是字符串,PG 自转。
 *
 * 时间参数一律先转 ISO 字符串、SQL 里显式 `::timestamptz`:Drizzle 会把 postgres.js 的 Date 序列化器改成透传(driver.ts),
 * 直接传 Date 会炸 "The string argument must be of type string… Received an instance of Date"(5FD 首接实测);Prisma 则把字符串
 * 当 text 类型绑定,不显式 cast 会报 timestamptz <= text。两边都照顾到的做法就是「字符串 + cast」。
 */
import { audienceFromParts, audienceValues, clampLimit, decodeCursor, encodeCursor, normalizeActions, pgArrayLiteral, } from "../core/logic.js";
const DEFAULT_TABLES = { notices: "notice", deliveries: "notice_delivery", receipts: "notice_receipt" };
function assertIdent(name) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(name))
        throw new Error(`非法表名: ${name}`);
    return name;
}
const toDate = (v) => (v instanceof Date ? v : new Date(String(v)));
const toDateN = (v) => (v == null ? null : toDate(v));
const BAD_JSON = Symbol("bad-json");
/** jsonb 列:有的驱动给对象、有的给字符串;解析失败返回 BAD_JSON(由调用方决定回落 + 告警) */
function parseJsonCol(v) {
    if (typeof v !== "string")
        return v;
    try {
        return JSON.parse(v);
    }
    catch {
        return BAD_JSON;
    }
}
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** actions 读回也走与写入同一份校验(normalizeActions):库里被直接改坏的 javascript: 链接不会流到前端 */
function readActions(v, noticeId, warn) {
    const raw = parseJsonCol(v);
    if (raw == null)
        return [];
    if (raw !== BAD_JSON) {
        try {
            return normalizeActions(raw);
        }
        catch { /* 落到下面告警 */ }
    }
    warn?.("notice.actions 读回不合规,按空处理", { noticeId, field: "actions" });
    return [];
}
/** meta / payload 只收 JSON 对象;其余(数组、标量、坏 JSON)回落并告警 */
function readObject(v, noticeId, field, warn) {
    const raw = parseJsonCol(v);
    if (raw == null)
        return null;
    if (isPlainObject(raw))
        return raw;
    warn?.(`${field} 读回不是 JSON 对象,按默认值处理`, { noticeId, field });
    return null;
}
/** PG 驱动对 text[] 的返回有的是数组有的是 `{a,b}` 字符串,两种都收 */
function toStrArray(v) {
    if (Array.isArray(v))
        return v.map(String);
    if (typeof v !== "string")
        return [];
    const s = v.trim();
    if (!s.startsWith("{"))
        return [];
    const inner = s.slice(1, -1);
    if (!inner)
        return [];
    const out = [];
    let cur = "";
    let quoted = false;
    let i = 0;
    while (i < inner.length) {
        const ch = inner.charAt(i); // i < inner.length,与 inner[i] 等价
        if (quoted) {
            if (ch === "\\") {
                cur += inner[i + 1] ?? "";
                i += 2;
                continue;
            }
            if (ch === '"') {
                quoted = false;
                i += 1;
                continue;
            }
            cur += ch;
            i += 1;
            continue;
        }
        if (ch === '"') {
            quoted = true;
            i += 1;
            continue;
        }
        if (ch === ",") {
            out.push(cur);
            cur = "";
            i += 1;
            continue;
        }
        cur += ch;
        i += 1;
    }
    out.push(cur);
    return out;
}
const NOTICE_COLS = `id, kind, severity, surfaces, title, body, cover, icon, actions, audience_type, audience_values, start_at, end_at,
  pinned, sort_order, frequency, frequency_hours, max_popups, force_read, closable, status, idem_key, batch_id, source, created_by, meta,
  created_at, updated_at, published_at, revoked_at`;
// biome-ignore lint/suspicious/noExplicitAny: 对外导出的函数签名(.d.ts 里是 r: any),改成 unknown 等类型会改变公共 API;行来自驱动,形状由 NOTICE_COLS 保证
export function mapNoticeRow(r, warn) {
    const id = String(r.id);
    return {
        id,
        kind: r.kind, severity: r.severity,
        surfaces: toStrArray(r.surfaces),
        title: String(r.title), body: String(r.body ?? ""),
        cover: r.cover ?? null, icon: r.icon ?? null,
        actions: readActions(r.actions, id, warn),
        audience: audienceFromParts(String(r.audience_type), toStrArray(r.audience_values)),
        startAt: toDateN(r.start_at), endAt: toDateN(r.end_at),
        pinned: Boolean(r.pinned), sortOrder: Number(r.sort_order ?? 0),
        frequency: r.frequency, frequencyHours: Number(r.frequency_hours ?? 24), maxPopups: Number(r.max_popups ?? 1),
        forceRead: Boolean(r.force_read), closable: r.closable == null ? true : Boolean(r.closable),
        status: r.status, idemKey: r.idem_key ?? null, batchId: r.batch_id ?? null,
        source: String(r.source ?? "admin"), createdBy: String(r.created_by ?? ""),
        meta: readObject(r.meta, id, "notice.meta", warn) ?? {},
        createdAt: toDate(r.created_at), updatedAt: toDate(r.updated_at),
        publishedAt: toDateN(r.published_at), revokedAt: toDateN(r.revoked_at),
    };
}
function mapReceiptRow(r, noticeId, userId) {
    if (r.r_notice_id == null)
        return null;
    return {
        noticeId, userId,
        seenAt: toDateN(r.seen_at), readAt: toDateN(r.read_at), archivedAt: toDateN(r.archived_at),
        dismissedUntil: toDateN(r.dismissed_until), popupCount: Number(r.popup_count ?? 0), lastPopupAt: toDateN(r.last_popup_at),
    };
}
const COL_OF_NOTICE = {
    kind: "kind", severity: "severity", surfaces: "surfaces", title: "title", body: "body", cover: "cover", icon: "icon", actions: "actions",
    audience: "audience", startAt: "start_at", endAt: "end_at", pinned: "pinned", sortOrder: "sort_order", frequency: "frequency",
    frequencyHours: "frequency_hours", maxPopups: "max_popups", forceRead: "force_read", closable: "closable", status: "status",
    idemKey: "idem_key", batchId: "batch_id", source: "source", createdBy: "created_by", meta: "meta", updatedAt: "updated_at",
    publishedAt: "published_at", revokedAt: "revoked_at",
};
const P_UID = 2;
const RECEIPT_COLS = `r.notice_id as r_notice_id, r.seen_at, r.read_at, r.archived_at, r.dismissed_until, r.popup_count, r.last_popup_at`;
/** 插入通知的 SQL 与参数(insertNotice 与原子写入共用一份,列顺序与 NOTICE_COLS 一致) */
function insertNoticeStatement(table, n) {
    return {
        sql: `insert into ${table} (${NOTICE_COLS}) values ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9::jsonb,$10,$11::text[],$12::timestamptz,$13::timestamptz,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,$27::timestamptz,$28::timestamptz,$29::timestamptz,$30::timestamptz)`,
        values: [n.id, n.kind, n.severity, pgArrayLiteral(n.surfaces), n.title, n.body, n.cover, n.icon, JSON.stringify(n.actions),
            n.audience.type, pgArrayLiteral(audienceValues(n.audience)), n.startAt, n.endAt, n.pinned, n.sortOrder, n.frequency,
            n.frequencyHours, n.maxPopups, n.forceRead, n.closable, n.status, n.idemKey, n.batchId, n.source, n.createdBy,
            JSON.stringify(n.meta), n.createdAt, n.updatedAt, n.publishedAt, n.revokedAt],
    };
}
/**
 * 可选方法的 PG 实现:都是**单条语句**(数据修改型 CTE),PG 保证单语句原子 —— 不需要宿主给事务连接,
 * pg Pool / postgres.js / Prisma raw 一样能用。半途失败 = 整条回滚,不会出现「通知在、投递缺一半」。
 */
function atomicOps({ T, db }) {
    return {
        async countByPhase(now) {
            const live = `status = 'published' and (start_at is null or start_at <= $1::timestamptz) and (end_at is null or end_at > $1::timestamptz)`;
            const { rows } = await db.query(`select count(*) filter (where status = 'draft')::int as draft, count(*) filter (where status = 'revoked')::int as revoked,
                count(*) filter (where status = 'published' and start_at is not null and start_at > $1::timestamptz)::int as scheduled,
                count(*) filter (where status = 'published' and end_at is not null and end_at <= $1::timestamptz and not (start_at is not null and start_at > $1::timestamptz))::int as expired,
                count(*) filter (where ${live})::int as live
         from ${T.n}`, [now]);
            const r = rows[0] ?? {};
            const out = { draft: 0, scheduled: 0, live: 0, expired: 0, revoked: 0 };
            for (const k of Object.keys(out))
                out[k] = Number(r[k] ?? 0);
            return out;
        },
        async insertNoticeWithDeliveries(n, userIds) {
            const { sql, values } = insertNoticeStatement(T.n, n);
            values.push(pgArrayLiteral(userIds));
            const pIds = values.length;
            await db.query(`with ins as (${sql} returning id)
         insert into ${T.d} (notice_id, user_id, payload, created_at)
         select ins.id, u.uid, null, $27::timestamptz from ins cross join unnest($${pIds}::text[]) as u(uid)
         on conflict (notice_id, user_id) do nothing`, values);
        },
        async replaceDeliveries(noticeId, userIds, createdAt) {
            // notice_id 取自通知表本身(n.id),不靠参数推断类型:宿主主键是 bigint 也不会撞 text → bigint
            await db.query(`with del as (delete from ${T.d} where notice_id = $1 and not (user_id = any($2::text[])))
         insert into ${T.d} (notice_id, user_id, payload, created_at)
         select n.id, u.uid, null, $3::timestamptz from ${T.n} n cross join unnest($2::text[]) as u(uid) where n.id = $1
         on conflict (notice_id, user_id) do nothing`, [noticeId, pgArrayLiteral(userIds), createdAt]);
        },
    };
}
function noticeCrudOps({ T, db, warn }) {
    return {
        async insertNotice(n) {
            const { sql, values } = insertNoticeStatement(T.n, n);
            await db.query(sql, values);
        },
        async updateNotice(id, patch) {
            const sets = [];
            const values = [];
            for (const [k, v] of Object.entries(patch)) {
                if (k === "id" || k === "createdAt")
                    continue;
                const col = COL_OF_NOTICE[k];
                if (!col)
                    continue;
                if (k === "audience") {
                    const a = v;
                    values.push(a.type);
                    sets.push(`audience_type = $${values.length}`);
                    values.push(pgArrayLiteral(audienceValues(a)));
                    sets.push(`audience_values = $${values.length}::text[]`);
                }
                else if (k === "surfaces") {
                    values.push(pgArrayLiteral(v));
                    sets.push(`surfaces = $${values.length}::text[]`);
                }
                else if (k === "actions" || k === "meta") {
                    values.push(JSON.stringify(v));
                    sets.push(`${col} = $${values.length}::jsonb`);
                }
                else if (v instanceof Date || k === "startAt" || k === "endAt" || k === "updatedAt" || k === "publishedAt" || k === "revokedAt") {
                    values.push(v);
                    sets.push(`${col} = $${values.length}::timestamptz`);
                }
                else {
                    values.push(v);
                    sets.push(`${col} = $${values.length}`);
                }
            }
            if (!sets.length)
                return this.getNotice(id);
            values.push(id);
            // 发布不能复活已撤回的(与 revokeBatch 并发时后写者不能赢)
            const guard = patch.status === "published" ? " and status <> 'revoked'" : "";
            const { rows } = await db.query(`update ${T.n} set ${sets.join(", ")} where id = $${values.length}${guard} returning ${NOTICE_COLS}`, values);
            return rows[0] ? mapNoticeRow(rows[0], warn) : null;
        },
        async getNotice(id) {
            const { rows } = await db.query(`select ${NOTICE_COLS} from ${T.n} where id = $1`, [id]);
            return rows[0] ? mapNoticeRow(rows[0], warn) : null;
        },
    };
}
function noticeQueryOps({ T, db, warn }) {
    return {
        async findByIdemKey(idemKey) {
            const { rows } = await db.query(`select ${NOTICE_COLS} from ${T.n} where idem_key = $1`, [idemKey]);
            return rows[0] ? mapNoticeRow(rows[0], warn) : null;
        },
        async listNotices(filter, now) {
            const limit = clampLimit(filter.limit);
            const offset = decodeCursor(filter.cursor);
            const values = [];
            const conds = [];
            if (filter.status) {
                values.push(filter.status);
                conds.push(`status = $${values.length}`);
            }
            if (filter.kind) {
                values.push(filter.kind);
                conds.push(`kind = $${values.length}`);
            }
            if (filter.surface) {
                values.push(filter.surface);
                conds.push(`$${values.length} = any(surfaces)`);
            }
            if (filter.batchId) {
                values.push(filter.batchId);
                conds.push(`batch_id = $${values.length}`);
            }
            // 搜索词按字面匹配:% _ \ 先转义,否则搜「50%」会匹配成任意「50…」
            if (filter.q?.trim()) {
                values.push(`%${escapeLike(filter.q.trim())}%`);
                conds.push(`(title ilike $${values.length} escape '\\' or body ilike $${values.length} escape '\\')`);
            }
            if (filter.phase === "draft" || filter.phase === "revoked")
                conds.push(`status = '${filter.phase}'`);
            else if (filter.phase) {
                // 只有要比时间的阶段才推 now:pg 对「推了却没用到」的参数报 42P18 could not determine data type(会员中心实测)
                values.push(now);
                const p = values.length;
                const byPhase = {
                    scheduled: `status = 'published' and start_at is not null and start_at > $${p}::timestamptz`,
                    expired: `status = 'published' and end_at is not null and end_at <= $${p}::timestamptz`,
                    live: `status = 'published' and (start_at is null or start_at <= $${p}::timestamptz) and (end_at is null or end_at > $${p}::timestamptz)`,
                };
                conds.push(`(${byPhase[filter.phase]})`);
            }
            values.push(limit);
            const pLim = values.length;
            values.push(offset);
            const pOff = values.length;
            const { rows } = await db.query(`select ${NOTICE_COLS} from ${T.n} ${conds.length ? `where ${conds.join(" and ")}` : ""} order by updated_at desc, id desc limit $${pLim} offset $${pOff}`, values);
            const items = rows.map((r) => mapNoticeRow(r, warn));
            return { items, nextCursor: encodeCursor(offset, items.length, limit) };
        },
        async deleteNotice(id) {
            const { rows } = await db.query(`delete from ${T.n} where id = $1 returning id`, [id]);
            return rows.length > 0;
        },
        async updateBatchStatus(batchId, patch, onlySource) {
            const values = [batchId, patch.status, patch.revokedAt, patch.updatedAt];
            let extra = "";
            if (onlySource) {
                values.push(onlySource);
                extra = ` and source = $${values.length}`;
            }
            const { rows } = await db.query(`update ${T.n} set status = $2, revoked_at = $3::timestamptz, updated_at = $4::timestamptz where batch_id = $1 and status <> 'revoked'${extra} returning id`, values);
            return rows.length;
        },
        async pruneDeliveries(noticeId, keep) {
            const { rows } = await db.query(`delete from ${T.d} where notice_id = $1 and not (user_id = any($2::text[])) returning user_id`, [noticeId, pgArrayLiteral(keep)]);
            return rows.length;
        },
        async insertDeliveries(rowsIn) {
            if (!rowsIn.length)
                return;
            for (let i = 0; i < rowsIn.length; i += 500) {
                const chunk = rowsIn.slice(i, i + 500);
                const values = [];
                const tuples = [];
                for (const r of chunk) {
                    values.push(r.noticeId, r.userId, r.payload ? JSON.stringify(r.payload) : null, r.createdAt);
                    const b = values.length;
                    tuples.push(`($${b - 3}, $${b - 2}, $${b - 1}::jsonb, $${b}::timestamptz)`);
                }
                await db.query(`insert into ${T.d} (notice_id, user_id, payload, created_at) values ${tuples.join(",")} on conflict (notice_id, user_id) do nothing`, values);
            }
        },
    };
}
function feedOps({ T, db, warn, visibleCte, receiptJoin }) {
    return {
        async listFeed(ctx, q, now) {
            const limit = clampLimit(q.limit);
            const offset = decodeCursor(q.cursor);
            const values = [];
            const surfaces = q.surfaces?.length ? q.surfaces : q.surface ? [q.surface] : null;
            let pSurf = 0; // 两个分支共用同一个参数位(surfaceCond 会被调用两次)
            const surfaceCond = (col) => {
                if (!surfaces)
                    return "true";
                if (!pSurf) {
                    values.push(pgArrayLiteral(surfaces));
                    pSurf = values.length;
                }
                return `${col} && $${pSurf}::text[]`;
            };
            // 注意顺序:visibleCte 先占 $1..$5,surfaceCond 在其内部被调用时再往后占
            const cte = visibleCte(ctx, now, values, surfaceCond);
            const where = [];
            if (q.kind) {
                values.push(q.kind);
                where.push(`n.kind = $${values.length}`);
            }
            if (!q.includeArchived)
                where.push(`r.archived_at is null`);
            if (q.unreadOnly)
                where.push(`r.read_at is null`);
            values.push(limit);
            const pLim = values.length;
            values.push(offset);
            const pOff = values.length;
            const { rows } = await db.query(`with ${cte}
         select ${NOTICE_COLS.replace(/(^|,\s*)(\w+)/g, "$1n.$2")}, ${RECEIPT_COLS}, d.payload as d_payload
         from vis join ${T.n} n on n.id = vis.id ${receiptJoin(P_UID)} left join ${T.d} d on d.notice_id = n.id and d.user_id = $${P_UID}
         ${where.length ? `where ${where.join(" and ")}` : ""}
         order by n.pinned desc, n.sort_order desc,
           case n.severity when 'critical' then 3 when 'high' then 2 when 'normal' then 1 else 0 end desc,
           coalesce(n.published_at, n.created_at) desc, n.id desc
         limit $${pLim} offset $${pOff}`, values);
            const items = rows.map((r) => {
                const notice = mapNoticeRow(r, warn);
                return { notice, receipt: mapReceiptRow(r, notice.id, ctx.userId), payload: readObject(r.d_payload, notice.id, "notice_delivery.payload", warn) };
            });
            return { items, nextCursor: encodeCursor(offset, items.length, limit) };
        },
        async countUnread(ctx, now) {
            const values = [];
            const cte = visibleCte(ctx, now, values, (col) => `${col} @> '{inbox}'::text[]`);
            const { rows } = await db.query(`with ${cte} select count(*)::int as n from vis join ${T.n} n on n.id = vis.id ${receiptJoin(P_UID)} where r.read_at is null and r.archived_at is null`, values);
            return Number(rows[0]?.n ?? 0);
        },
        async getReceipt(noticeId, userId) {
            const { rows } = await db.query(`select notice_id as r_notice_id, seen_at, read_at, archived_at, dismissed_until, popup_count, last_popup_at from ${T.r} where notice_id = $1 and user_id = $2`, [noticeId, userId]);
            return rows[0] ? mapReceiptRow(rows[0], noticeId, userId) : null;
        },
        async touchReceipts(userId, noticeIds, patch) {
            if (!noticeIds.length)
                return;
            const sets = [];
            const cols = [];
            const values = [userId, pgArrayLiteral(noticeIds)];
            const put = (col, v) => {
                if (v === undefined)
                    return;
                values.push(v);
                cols.push(col);
                sets.push(`${col} = excluded.${col}`);
            };
            put("seen_at", patch.seenAt);
            put("read_at", patch.readAt);
            put("archived_at", patch.archivedAt);
            put("dismissed_until", patch.dismissedUntil);
            const colList = ["notice_id", "user_id", ...cols].join(", ");
            const valList = ["x.id", "$1", ...cols.map((_, i) => `$${i + 3}::timestamptz`)].join(", ");
            // 只给真实存在的通知写回执:不存在的 id 直接被 where 过滤,不会撞 FK 变 500;
            // 定向通知(users)还要求本人在投递名单里,否则任何登录用户都能给别人的站内信刷「已读」、抬高统计
            await db.query(`insert into ${T.r} (${colList}) select ${valList} from unnest($2::text[]) as x(id) where exists (select 1 from ${T.n} n where n.id = x.id
           and (n.audience_type <> 'users' or exists (select 1 from ${T.d} dd where dd.notice_id = n.id and dd.user_id = $1)))
         on conflict (notice_id, user_id) do update set ${sets.length ? sets.join(", ") : "notice_id = excluded.notice_id"}`, values);
        },
    };
}
function receiptOps({ T, db, visibleCte, receiptJoin }) {
    return {
        async markAllRead(ctx, now) {
            const values = [];
            const cte = visibleCte(ctx, now, values, (col) => `${col} @> '{inbox}'::text[]`);
            values.push(now);
            const pNow2 = values.length;
            const { rows } = await db.query(`with ${cte}
         insert into ${T.r} (notice_id, user_id, seen_at, read_at)
         select n.id, $2, $${pNow2}::timestamptz, $${pNow2}::timestamptz from vis join ${T.n} n on n.id = vis.id ${receiptJoin(P_UID)}
         where r.read_at is null and r.archived_at is null
         on conflict (notice_id, user_id) do update set read_at = excluded.read_at, seen_at = coalesce(${T.r}.seen_at, excluded.seen_at)
         returning notice_id`, values);
            return rows.length;
        },
        async bumpPopup(noticeId, userId, now) {
            await db.query(`insert into ${T.r} (notice_id, user_id, seen_at, popup_count, last_popup_at) select $1, $2, $3::timestamptz, 1, $3::timestamptz where exists (select 1 from ${T.n} n where n.id = $1
           and (n.audience_type <> 'users' or exists (select 1 from ${T.d} dd where dd.notice_id = n.id and dd.user_id = $2)))
         on conflict (notice_id, user_id) do update set popup_count = ${T.r}.popup_count + 1, last_popup_at = excluded.last_popup_at, seen_at = coalesce(${T.r}.seen_at, excluded.seen_at)`, [noticeId, userId, now]);
        },
        async stats(noticeId) {
            const { rows } = await db.query(`select count(*) filter (where seen_at is not null)::int as seen, count(*) filter (where read_at is not null)::int as read,
                count(*) filter (where archived_at is not null)::int as archived, coalesce(sum(popup_count), 0)::int as popups
         from ${T.r} where notice_id = $1`, [noticeId]);
            const { rows: d } = await db.query(`select n.audience_type, (select count(*)::int from ${T.d} where notice_id = n.id) as delivered from ${T.n} n where n.id = $1`, [noticeId]);
            const s = rows[0] ?? {};
            return {
                noticeId, seen: Number(s.seen ?? 0), read: Number(s.read ?? 0), archived: Number(s.archived ?? 0), popups: Number(s.popups ?? 0),
                delivered: d[0]?.audience_type === "users" ? Number(d[0].delivered ?? 0) : null,
            };
        },
        async purge(before) {
            // 三类到期:定过期时间的过了 / 撤回超期 / 定向站内信(没有过期时间)按创建时间超期。
            // 分批删(每批 5000),30 万行级联 delivery/receipt 一条语句删会长时间持锁 + IO 尖峰。
            let total = 0;
            for (let i = 0; i < 200; i += 1) {
                const { rows } = await db.query(`delete from ${T.n} where id in (
             select id from ${T.n}
              where (end_at is not null and end_at < $1::timestamptz)
                 or (revoked_at is not null and revoked_at < $1::timestamptz)
                 or (audience_type = 'users' and end_at is null and created_at < $1::timestamptz)
              limit 5000)
           returning id`, [before]);
                total += rows.length;
                if (rows.length < 5000)
                    break;
            }
            return total;
        },
    };
}
export function createSqlPgTongzhiStore(options) {
    const T = {
        n: assertIdent(options.tables?.notices ?? DEFAULT_TABLES.notices),
        d: assertIdent(options.tables?.deliveries ?? DEFAULT_TABLES.deliveries),
        r: assertIdent(options.tables?.receipts ?? DEFAULT_TABLES.receipts),
    };
    const raw = options.db;
    /** 统一出口:Date → ISO(见文件头);其余原样 */
    const db = { query: (text, values) => raw.query(text, values?.map((v) => (v instanceof Date ? v.toISOString() : v))) };
    /**
     * 「此人可见」的候选集(CTE `vis`):**两条分支 UNION ALL**,各走各的索引 ——
     *   ① 广播分支(audience_type <> 'users'):all / tiers / tags / roles,表里只有几十行,走部分索引 notice_broadcast_idx
     *   ② 定向分支:从 notice_delivery(user_id) 反查本人的投递,再回表判生效窗口
     * 之前写成一个 OR(… exists …)会让规划器只能全表扫(5ff 30 万条站内信时每条 SQL 1.2s,审计 2026-09-04)。
     * 展示面过滤用 `surfaces @> / &&`(GIN 可索引),不用 `= any(surfaces)`。
     */
    function visibleCte(ctx, now, values, surfaceCond) {
        values.push(now);
        const pNow = values.length;
        values.push(ctx.userId);
        const pUid = values.length;
        values.push(pgArrayLiteral(ctx.tier ? [ctx.tier] : []));
        const pTier = values.length;
        values.push(pgArrayLiteral(ctx.tags ?? []));
        const pTags = values.length;
        values.push(pgArrayLiteral(ctx.roles ?? []));
        const pRoles = values.length;
        const live = (a) => `${a}.status = 'published' and (${a}.start_at is null or ${a}.start_at <= $${pNow}::timestamptz) and (${a}.end_at is null or ${a}.end_at > $${pNow}::timestamptz)`;
        return `vis as (
      select b.id from ${T.n} b
       where b.audience_type <> 'users' and ${live("b")} and ${surfaceCond("b.surfaces")}
         and (b.audience_type = 'all'
           or (b.audience_type = 'tiers' and b.audience_values && $${pTier}::text[])
           or (b.audience_type = 'tags'  and b.audience_values && $${pTags}::text[])
           or (b.audience_type = 'roles' and b.audience_values && $${pRoles}::text[]))
      union all
      select t.id from ${T.d} d join ${T.n} t on t.id = d.notice_id
       where d.user_id = $${pUid} and ${live("t")} and ${surfaceCond("t.surfaces")}
    )`;
    }
    const receiptJoin = (pUid) => `left join ${T.r} r on r.notice_id = n.id and r.user_id = $${pUid}`;
    // 四组方法按原顺序展开成同一个对象:updateNotice 里的 this.getNotice 仍指向最终的 store 对象
    const c = { T, db, warn: options.onWarn, visibleCte, receiptJoin };
    return { ...noticeCrudOps(c), ...noticeQueryOps(c), ...feedOps(c), ...receiptOps(c), ...atomicOps(c) };
}
/** LIKE / ILIKE 模式转义(配合 `escape '\'`):\ % _ 都按字面 */
function escapeLike(s) {
    return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
