/**
 * zhanghao/recharge-adjustments —— 后台手动调整用户的「累充金额」(增 / 删 / 改 / 查)。
 *
 * 业主(2026-09-23):「给账号里面增加一个功能,我可以单独给用户去增加累充金额,在后台用户管理里面,
 * 增删改查都行,统一一下。」—— 补偿、线下收款、迁移漏单这类场景,运营要能直接把累充补上或扣掉。
 *
 * ── 口径(接入前必读) ─────────────────────────────────────────────────────
 *
 *   有效累充 = max(0, 真实充值 + Σ 生效中的调整)          ← `effectiveCents(userId, realCents)`
 *
 *   1. 调整是**一条条带原因的记录**,可正可负。「改」改金额/原因,「删」= 作废(留痕,不抹掉)。
 *      每一次增 / 改 / 删都落一条事件(改前 → 改后、谁、何时、requestId),事后能完整复原。
 *   2. **只进「按累充裁决」的那一处**(各站的「有效累充」唯一入口:CDK 门槛、累充活动、开箱门槛……),
 *      **绝不进财务 / 营收 / 对账 / 运营看板** —— 那里只能算真钱。调整混进营收,账就再也对不上,而且不报错。
 *   3. 结果**下限 0**:扣到比真实充值还多时显示 0,不出现负累充(负数进门槛比较不会报错,只会让人永远不达标)。
 *   4. 金额一律**整数分(bigint)**,不碰浮点;界面上给运营看「元」。
 *
 * ── 并发与幂等(三条都靠数据库,不靠「先查再写」)───────────────────────────────
 *
 *   - 新增:`(created_by, request_id)` 唯一。同一个 requestId 重放 → 回原记录(replayed=true),不二次生效;
 *     同一 requestId 拿去加另一笔(用户或金额不同)→ REQUEST_ID_CONFLICT。
 *   - 改 / 删:带 `expectedRevision`,`UPDATE … WHERE revision = $expected AND status = 'active'`。
 *     两个运营同时改同一条,只有一个成功,另一个得到 REVISION_CONFLICT(界面提示刷新),不会互相覆盖。
 *   - 事件与主记录**同一条 SQL**(CTE)写入:不存在「金额改了但没留痕」的中间态,也不需要宿主开事务。
 */
import { ZhanghaoError, isZhanghaoError } from "./types.js";
export const DEFAULT_MAX_ABS_ADJUSTMENT_CENTS = 100000000n;
export const MAX_ADJUSTMENT_REASON_LENGTH = 200;
function fail(message, field) {
    throw new ZhanghaoError("VALIDATION", message, { field });
}
function checkAmount(amount, max) {
    if (typeof amount !== "bigint")
        fail("金额必须是整数分", "amountCents");
    if (amount === 0n)
        fail("调整金额不能为 0", "amountCents");
    const abs = amount < 0n ? -amount : amount;
    if (abs > max)
        fail(`单笔调整不能超过 ¥${(max / 100n).toString()}`, "amountCents");
    return amount;
}
function checkReason(reason, field = "reason") {
    const r = typeof reason === "string" ? reason.trim() : "";
    if (!r)
        fail("必须填写原因(审计要看得懂这笔为什么加 / 减)", field);
    if ([...r].length > MAX_ADJUSTMENT_REASON_LENGTH)
        fail(`原因最多 ${MAX_ADJUSTMENT_REASON_LENGTH} 个字`, field);
    return r;
}
function checkRevision(rev) {
    if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 1)
        fail("缺少 expectedRevision(先读后改,防止两人同时改互相覆盖)", "expectedRevision");
    return rev;
}
function checkCtx(ctx) {
    if (!ctx?.operatorId)
        throw new ZhanghaoError("FORBIDDEN", "缺少操作人");
    if (!ctx.requestId?.trim())
        fail("后台动作必须带 requestId(幂等锚)", "requestId");
}
export function snapshotOf(row) {
    return { amountCents: row.amountCents.toString(), reason: row.reason, status: row.status };
}
/** 只读的几项:直接转给 store,不碰审计 / 幂等 */
function readApi(store) {
    return {
        sumActive: (userId) => store.sumActive(userId),
        async sumActiveMany(userIds) {
            const uniq = [...new Set(userIds)];
            if (store.sumActiveMany)
                return store.sumActiveMany(uniq);
            const out = new Map();
            for (const id of uniq)
                out.set(id, await store.sumActive(id));
            return out;
        },
        async effectiveCents(userId, realCents) {
            const sum = await store.sumActive(userId);
            const total = realCents + sum;
            return total < 0n ? 0n : total;
        },
        list: (userId, o) => store.list(userId, { includeRevoked: o?.includeRevoked ?? true }),
        events: (userId, o) => store.listEvents(userId, { ...(o?.beforeId ? { beforeId: o.beforeId } : {}), limit: Math.min(Math.max(o?.limit ?? 50, 1), 200) }),
    };
}
/** 写操作共用的回调 / 重放判定 / 未命中解释;只依赖 opts 与 store */
function writeHelpers(opts, store) {
    async function notify(action, row, operatorId) {
        if (!opts.onChange)
            return;
        try {
            await opts.onChange({ action, row, operatorId });
        }
        catch {
            /* 已生效的结果不因回调失败而回滚;宿主自己在回调里记错 */
        }
    }
    /** 改 / 删的重放判定:同一 (operator, requestId) 已经有事件 → 必须是同一条、同一种动作 */
    async function replayOf(id, action, ctx) {
        const ev = await store.findEvent(ctx.operatorId, ctx.requestId);
        if (!ev)
            return null;
        if (ev.adjustmentId !== id || ev.action !== action) {
            throw new ZhanghaoError("REQUEST_ID_CONFLICT", "这个 requestId 已用于另一个动作");
        }
        const row = await store.get(id);
        if (!row)
            throw new ZhanghaoError("ADJUSTMENT_NOT_FOUND", "调整记录不存在");
        return { row, replayed: true };
    }
    /** 改 / 删没生效时说清楚是哪种情况(不存在 / 已作废 / 被别人改过) */
    async function explainMiss(id, action, ctx) {
        const replay = await replayOf(id, action, ctx);
        if (replay)
            return replay; // 并发的同一请求刚写进去
        const row = await store.get(id);
        if (!row)
            throw new ZhanghaoError("ADJUSTMENT_NOT_FOUND", "调整记录不存在");
        if (row.status !== "active")
            throw new ZhanghaoError("REVISION_CONFLICT", "这条调整已被作废,请刷新", { revision: row.revision });
        throw new ZhanghaoError("REVISION_CONFLICT", "这条调整刚被别人改过,请刷新后再改", { revision: row.revision });
    }
    return { notify, replayOf, explainMiss };
}
export function createRechargeAdjustments(opts) {
    const store = opts.store;
    const max = opts.maxAbsCents ?? DEFAULT_MAX_ABS_ADJUSTMENT_CENTS;
    const { notify, replayOf, explainMiss } = writeHelpers(opts, store);
    const api = {
        ...readApi(store),
        async create(input, ctx) {
            checkCtx(ctx);
            if (!input.userId)
                fail("缺少用户", "userId");
            const amountCents = checkAmount(input.amountCents, max);
            const reason = checkReason(input.reason);
            // 先判重放:同一次点击的重试不该因为「用户后来被删了」之类变化而报错
            const prior = await store.findByRequest(ctx.operatorId, ctx.requestId);
            if (prior) {
                if (prior.userId !== input.userId || prior.amountCents !== amountCents) {
                    throw new ZhanghaoError("REQUEST_ID_CONFLICT", "这个 requestId 已用于另一笔调整");
                }
                return { row: prior, replayed: true };
            }
            if (opts.userExists && !(await opts.userExists(input.userId))) {
                throw new ZhanghaoError("USER_NOT_FOUND", "用户不存在");
            }
            const r = await store.insert({ userId: input.userId, amountCents, reason, requestId: ctx.requestId, createdBy: ctx.operatorId });
            if (!r.created) {
                if (r.row.userId !== input.userId || r.row.amountCents !== amountCents) {
                    throw new ZhanghaoError("REQUEST_ID_CONFLICT", "这个 requestId 已用于另一笔调整");
                }
                return { row: r.row, replayed: true };
            }
            await notify("create", r.row, ctx.operatorId);
            return { row: r.row, replayed: false };
        },
        async update(id, input, ctx) {
            checkCtx(ctx);
            const expectedRevision = checkRevision(input.expectedRevision);
            if (input.amountCents === undefined && input.reason === undefined)
                fail("没有要改的字段", "amountCents");
            const replay = await replayOf(id, "update", ctx);
            if (replay)
                return replay;
            const cur = await store.get(id);
            if (!cur)
                throw new ZhanghaoError("ADJUSTMENT_NOT_FOUND", "调整记录不存在");
            const amountCents = input.amountCents === undefined ? cur.amountCents : checkAmount(input.amountCents, max);
            const reason = input.reason === undefined ? cur.reason : checkReason(input.reason);
            const row = await store.mutate({
                id,
                expectedRevision,
                operatorId: ctx.operatorId,
                requestId: ctx.requestId,
                next: { amountCents, reason, status: "active", revokeReason: null },
                action: "update",
            });
            if (!row)
                return explainMiss(id, "update", ctx);
            await notify("update", row, ctx.operatorId);
            return { row, replayed: false };
        },
        async revoke(id, input, ctx) {
            checkCtx(ctx);
            const expectedRevision = checkRevision(input.expectedRevision);
            const why = checkReason(input.reason);
            const replay = await replayOf(id, "revoke", ctx);
            if (replay)
                return replay;
            const cur = await store.get(id);
            if (!cur)
                throw new ZhanghaoError("ADJUSTMENT_NOT_FOUND", "调整记录不存在");
            const row = await store.mutate({
                id,
                expectedRevision,
                operatorId: ctx.operatorId,
                requestId: ctx.requestId,
                next: { amountCents: cur.amountCents, reason: cur.reason, status: "revoked", revokeReason: why },
                action: "revoke",
            });
            if (!row)
                return explainMiss(id, "revoke", ctx);
            await notify("revoke", row, ctx.operatorId);
            return { row, replayed: false };
        },
    };
    return api;
}
/* ────────────────────────────── 金额换算(界面「元」⇄ 存储「分」) ────────────────────────────── */
/**
 * 运营输入的「元」→ 分。只认 `-?\d+(\.\d{1,2})?`,**不经过浮点**(`0.1+0.2` 那类误差进钱账不报错)。
 * 非法返回 null(调用方自己提示),不夹取、不四舍五入。
 */
export function yuanToCents(input) {
    const s = input.trim().replace(/,/g, "");
    const m = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m)
        return null;
    const sign = m[1] === "-" ? -1n : 1n;
    // 第 2 组 (\d+) 不是可选组,匹配成功就一定有值;`?? "0"` 只为让类型收窄,不会走到
    const whole = BigInt(m[2] ?? "0");
    const frac = BigInt((m[3] ?? "").padEnd(2, "0") || "0");
    return sign * (whole * 100n + frac);
}
/**
 * 分 → 「¥1,234.50」:符号在 ¥ 前面(「-¥20.00」「+¥80.50」),不会出现「¥+80.50」。
 * 界面显示一律用它,别自己拼「¥」+ centsToYuan。
 */
export function formatYuan(cents, opts = {}) {
    const neg = cents < 0n;
    const body = centsToYuan(neg ? -cents : cents);
    const sign = neg ? "-" : opts.signed && cents > 0n ? "+" : "";
    return `${sign}¥${body}`;
}
/** 分 → 「1,234.50」(带正负号可选;不带 ¥。要 ¥ 用 formatYuan) */
export function centsToYuan(cents, opts = {}) {
    const neg = cents < 0n;
    const abs = neg ? -cents : cents;
    const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const frac = (abs % 100n).toString().padStart(2, "0");
    const sign = neg ? "-" : opts.signed && cents > 0n ? "+" : "";
    return `${sign}${whole}.${frac}`;
}
/* ────────────────────────────── 内存实现(测试 / 演示) ────────────────────────────── */
export function createMemoryRechargeAdjustmentStore(now = () => new Date()) {
    const rows = new Map();
    const events = [];
    let seq = 0;
    let evSeq = 0;
    const clone = (r) => ({ ...r });
    return {
        async sumActive(userId) {
            let s = 0n;
            for (const r of rows.values())
                if (r.userId === userId && r.status === "active")
                    s += r.amountCents;
            return s;
        },
        async list(userId, o) {
            return [...rows.values()]
                .filter((r) => r.userId === userId && (o.includeRevoked || r.status === "active"))
                .sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)))
                .map(clone);
        },
        async get(id) {
            const r = rows.get(id);
            return r ? clone(r) : null;
        },
        async findByRequest(createdBy, requestId) {
            for (const r of rows.values())
                if (r.createdBy === createdBy && r.requestId === requestId)
                    return clone(r);
            return null;
        },
        async insert(d) {
            for (const r of rows.values())
                if (r.createdBy === d.createdBy && r.requestId === d.requestId)
                    return { created: false, row: clone(r) };
            const t = now();
            const row = {
                id: String(++seq),
                userId: d.userId,
                amountCents: d.amountCents,
                reason: d.reason,
                status: "active",
                revision: 1,
                requestId: d.requestId,
                createdBy: d.createdBy,
                createdAt: t,
                updatedBy: null,
                updatedAt: t,
                revokedBy: null,
                revokedAt: null,
                revokeReason: null,
            };
            rows.set(row.id, row);
            events.push({ id: String(++evSeq), adjustmentId: row.id, userId: row.userId, action: "create", before: null, after: snapshotOf(row), operatorId: d.createdBy, requestId: d.requestId, note: null, createdAt: t });
            return { created: true, row: clone(row) };
        },
        async findEvent(operatorId, requestId) {
            return events.find((e) => e.operatorId === operatorId && e.requestId === requestId) ?? null;
        },
        async mutate(d) {
            const r = rows.get(d.id);
            if (!r || r.revision !== d.expectedRevision || r.status !== "active")
                return null;
            if (events.some((e) => e.operatorId === d.operatorId && e.requestId === d.requestId))
                return null;
            const before = snapshotOf(r);
            const t = now();
            r.amountCents = d.next.amountCents;
            r.reason = d.next.reason;
            r.status = d.next.status;
            r.revision += 1;
            r.updatedBy = d.operatorId;
            r.updatedAt = t;
            if (d.action === "revoke") {
                r.revokedBy = d.operatorId;
                r.revokedAt = t;
                r.revokeReason = d.next.revokeReason;
            }
            events.push({ id: String(++evSeq), adjustmentId: r.id, userId: r.userId, action: d.action, before, after: snapshotOf(r), operatorId: d.operatorId, requestId: d.requestId, note: d.action === "revoke" ? d.next.revokeReason : null, createdAt: t });
            return clone(r);
        },
        async listEvents(userId, o) {
            return events
                .filter((e) => e.userId === userId && (!o.beforeId || BigInt(e.id) < BigInt(o.beforeId)))
                .sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)))
                .slice(0, o.limit);
        },
    };
}
function ident(name) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(name))
        throw new Error(`非法表名: ${name}`);
    return name;
}
function toDate(v) {
    return v instanceof Date ? v : new Date(String(v));
}
function toSnapshot(v) {
    if (v === null || v === undefined)
        return null;
    const o = (typeof v === "string" ? JSON.parse(v) : v);
    return { amountCents: String(o.amountCents), reason: String(o.reason), status: o.status };
}
export function createSqlRechargeAdjustmentStore(o) {
    const A = ident(o.tableNames?.adjustments ?? "zh_recharge_adjustments");
    const E = ident(o.tableNames?.events ?? "zh_recharge_adjustment_events");
    const q = async (text, params = []) => {
        try {
            return (await o.query(text, params)).rows;
        }
        catch (err) {
            if (isZhanghaoError(err))
                throw err;
            throw new ZhanghaoError("STORE_UNAVAILABLE", "累充调整存储不可用", { cause: String(err?.message ?? err) });
        }
    };
    return { ...sqlReads(q, A), ...sqlWrites(q, A, E), ...sqlMutations(q, A, E) };
}
// ⚠ 输出列把 id 转成了 text 且仍叫 id:ORDER BY 必须写成「表名.id」,否则按输出列(字符串)排,
//   10 会排在 9 后面 —— 内存实现测不出来,真库记录过 9 条才现形(本包测试抓到过)。
const COLS = `id::text as id, user_id, amount_cents::text as amount_cents, reason, status, revision, request_id, created_by,
    created_at, updated_by, updated_at, revoked_by, revoked_at, revoke_reason`;
const row = (r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    amountCents: BigInt(r.amount_cents),
    reason: r.reason,
    status: r.status,
    revision: Number(r.revision),
    requestId: r.request_id,
    createdBy: String(r.created_by),
    createdAt: toDate(r.created_at),
    updatedBy: r.updated_by === null ? null : String(r.updated_by),
    updatedAt: toDate(r.updated_at),
    revokedBy: r.revoked_by === null ? null : String(r.revoked_by),
    revokedAt: r.revoked_at === null ? null : toDate(r.revoked_at),
    revokeReason: r.revoke_reason ?? null,
});
const EV_COLS = `id::text as id, adjustment_id::text as adjustment_id, user_id, action, before, after, operator_id, request_id, note, created_at`;
const ev = (r) => ({
    id: String(r.id),
    adjustmentId: String(r.adjustment_id),
    userId: String(r.user_id),
    action: r.action,
    before: toSnapshot(r.before),
    // 原来是 `!`(只骗类型、运行时不检查);after 列 NOT NULL,这里同样只做类型断言,不加运行时分支
    after: toSnapshot(r.after),
    operatorId: String(r.operator_id),
    requestId: r.request_id,
    note: r.note ?? null,
    createdAt: toDate(r.created_at),
});
/* 下面三组方法原来写在 createSqlRechargeAdjustmentStore 返回的一个对象里,按原顺序拆开只为把工厂拆短;SQL 文本一字未改 */
function sqlReads(q, A) {
    return {
        async sumActive(userId) {
            const rs = await q(`select coalesce(sum(amount_cents), 0)::text as s from ${A} where user_id = $1 and status = 'active'`, [userId]);
            return BigInt(rs[0]?.s ?? "0");
        },
        async sumActiveMany(userIds) {
            const out = new Map(userIds.map((id) => [id, 0n]));
            if (userIds.length === 0)
                return out;
            const rs = await q(`select user_id, sum(amount_cents)::text as s from ${A} where user_id = any($1::text[]) and status = 'active' group by user_id`, [userIds]);
            for (const r of rs)
                out.set(String(r.user_id), BigInt(r.s));
            return out;
        },
        async list(userId, opt) {
            const rs = await q(`select ${COLS} from ${A} where user_id = $1 ${opt.includeRevoked ? "" : "and status = 'active'"} order by ${A}.id desc limit 500`, [userId]);
            return rs.map(row);
        },
        async get(id) {
            if (!/^\d+$/.test(id))
                return null;
            const rs = await q(`select ${COLS} from ${A} where id = $1::bigint`, [id]);
            return rs[0] ? row(rs[0]) : null;
        },
        async findByRequest(createdBy, requestId) {
            const rs = await q(`select ${COLS} from ${A} where created_by = $1 and request_id = $2`, [createdBy, requestId]);
            return rs[0] ? row(rs[0]) : null;
        },
    };
}
/** insert 里用 `this.findByRequest`:合并后的 store 对象上调用时 this 就是整个 store(与拆之前相同) */
function sqlWrites(q, A, E) {
    return {
        async insert(d) {
            // 主记录与 create 事件同一条语句:要么都有,要么都没有
            const rs = await q(`with ins as (
           insert into ${A} (user_id, amount_cents, reason, request_id, created_by)
           values ($1, $2::bigint, $3, $4, $5)
           on conflict (created_by, request_id) do nothing
           returning *
         ), ev as (
           insert into ${E} (adjustment_id, user_id, action, before, after, operator_id, request_id)
           select id, user_id, 'create', null,
                  jsonb_build_object('amountCents', amount_cents::text, 'reason', reason, 'status', status),
                  created_by, request_id
           from ins
           returning id
         )
         select ${COLS} from ins`, [d.userId, d.amountCents.toString(), d.reason, d.requestId, d.createdBy]);
            if (rs[0])
                return { created: true, row: row(rs[0]) };
            const existing = await this.findByRequest(d.createdBy, d.requestId);
            if (!existing)
                throw new ZhanghaoError("STORE_UNAVAILABLE", "累充调整写入失败(并发冲突后未找到原记录)");
            return { created: false, row: existing };
        },
        async findEvent(operatorId, requestId) {
            const rs = await q(`select ${EV_COLS} from ${E} where operator_id = $1 and request_id = $2 and action <> 'create'`, [operatorId, requestId]);
            return rs[0] ? ev(rs[0]) : null;
        },
    };
}
function sqlMutations(q, A, E) {
    return {
        async mutate(d) {
            if (!/^\d+$/.test(d.id))
                return null;
            try {
                const rs = await q(`with prev as (
             select id, amount_cents, reason, status from ${A}
             where id = $1::bigint and revision = $2 and status = 'active'
             for update
           ), upd as (
             update ${A} a set
               amount_cents = $3::bigint, reason = $4, status = $5, revision = a.revision + 1,
               updated_by = $6, updated_at = now(),
               revoked_by = case when $5 = 'revoked' then $6 else a.revoked_by end,
               revoked_at = case when $5 = 'revoked' then now() else a.revoked_at end,
               revoke_reason = case when $5 = 'revoked' then $7 else a.revoke_reason end
             from prev where a.id = prev.id
             returning a.*
           ), ev as (
             insert into ${E} (adjustment_id, user_id, action, before, after, operator_id, request_id, note)
             select upd.id, upd.user_id, $8,
                    jsonb_build_object('amountCents', prev.amount_cents::text, 'reason', prev.reason, 'status', prev.status),
                    jsonb_build_object('amountCents', upd.amount_cents::text, 'reason', upd.reason, 'status', upd.status),
                    $6, $9, $7
             from upd join prev on prev.id = upd.id
             returning id
           )
           select ${COLS} from upd`, [d.id, d.expectedRevision, d.next.amountCents.toString(), d.next.reason, d.next.status, d.operatorId, d.next.revokeReason, d.action, d.requestId]);
                return rs[0] ? row(rs[0]) : null;
            }
            catch (err) {
                // 事件 (operator_id, request_id) 唯一撞了 = 同一请求并发重放;整条语句已回滚,交给服务层按重放处理
                const cause = err?.detail?.cause;
                if (typeof cause === "string" && /duplicate key|23505|unique/i.test(cause))
                    return null;
                throw err;
            }
        },
        async listEvents(userId, opt) {
            const rs = await q(`select ${EV_COLS} from ${E} where user_id = $1 ${opt.beforeId && /^\d+$/.test(opt.beforeId) ? "and id < $3::bigint" : ""}
         order by ${E}.id desc limit $2`, opt.beforeId && /^\d+$/.test(opt.beforeId) ? [userId, opt.limit, opt.beforeId] : [userId, opt.limit]);
            return rs.map(ev);
        },
    };
}
