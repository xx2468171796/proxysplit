/**
 * 编排层:一个 createTongzhi() 拿到全部能力。
 *
 *   管理侧  create / update / publish / revoke / revokeBatch / remove / get / list / preview / stats / purge / templates
 *   业务侧  send({ userId | userIds, ... })      —— 到账、中奖、退款…定向消息一行发
 *   玩家侧  bundle / feed / unreadCount / markSeen / markRead / markAllRead / archive / dismiss / popupShown
 *
 * 纪律:
 *   - 幂等键 idemKey 全表唯一:重复 create/send 返回已有那条(不报错),这是回调重放 / cron 重跑的保护
 *   - 受众裁决在 store;弹窗频控在 core/logic.shouldPopup;service 只做编排与状态机
 *   - 状态机 draft → published → revoked;revoked 是终态;published 可 update(热改),不回 draft
 *   - 每次会改变玩家可见集的操作都调 realtime.invalidate(userIds|null),没接 realtime 就是空函数
 */
import { randomUUID } from "node:crypto";
import { applyPatch, clampLimit, isDismissed, newBatchId, normalizeInput, phaseOf, shouldPopup, } from "./core/logic.js";
import { plainText } from "./core/markdown.js";
import { applyTemplate, mergeTemplates } from "./core/templates.js";
import { NOTICE_PHASES, TongzhiError, } from "./types.js";
function createCore(opts) {
    const store = opts.store;
    const now = opts.now ?? (() => new Date());
    const newId = opts.newId ?? (() => randomUUID());
    const tz = opts.tzOffsetMin ?? 480;
    const realtime = opts.realtime ?? { invalidate() { } };
    const templates = mergeTemplates(opts.templates);
    const emit = async (e) => { try {
        await opts.onEvent?.(e);
    }
    catch { /* 钩子不许影响主流程 */ } };
    const invalidate = async (n) => { try {
        await realtime.invalidate(n.audience.type === "users" ? n.audience.userIds : null);
    }
    catch { /* 实时是锦上添花 */ } };
    async function mustGet(id) {
        const n = await store.getNotice(id);
        if (!n)
            throw new TongzhiError("NOT_FOUND", `通知不存在: ${id}`);
        return n;
    }
    return { opts, store, now, newId, tz, realtime, templates, emit, invalidate, mustGet };
}
/** 管理侧:新建 / 修改 */
function noticeWriteOps(c) {
    const { store, now, newId, emit, invalidate, mustGet } = c;
    /**
     * 幂等重试命中已有通知时补齐定向投递:上次「通知写进去、投递半途失败」的,重试即自愈
     * (insertDeliveries 对已有行不动)。store 支持原子写入时不会出现这种半截状态,省掉这次写。
     */
    async function repairDeliveries(n) {
        if (n.audience.type !== "users" || store.insertNoticeWithDeliveries)
            return;
        await store.insertDeliveries(deliveryRows(n.id, n.audience.userIds, n.createdAt));
        if (n.status === "published")
            await invalidate(n);
    }
    async function create(input, actor, opt = {}) {
        const fields = normalizeInput(input);
        if (fields.idemKey) {
            const dup = await store.findByIdemKey(fields.idemKey);
            if (dup) {
                await repairDeliveries(dup);
                return dup;
            }
        }
        const t = now();
        const publish = Boolean(opt.publish);
        const notice = {
            ...fields, id: newId(), status: publish ? "published" : "draft", source: actor.source ?? "admin", createdBy: actor.id,
            createdAt: t, updatedAt: t, publishedAt: publish ? t : null, revokedAt: null,
        };
        const users = notice.audience.type === "users" ? notice.audience.userIds : null;
        try {
            // store 支持就一条语句原子写「通知 + 投递」;否则分两步,半途失败靠下面的幂等重试补齐
            if (users && store.insertNoticeWithDeliveries)
                await store.insertNoticeWithDeliveries(notice, users);
            else
                await store.insertNotice(notice);
        }
        catch (err) {
            // 幂等键并发撞车:另一个请求刚插进去,回读它
            if (fields.idemKey && isUniqueViolation(err)) {
                const dup = await store.findByIdemKey(fields.idemKey);
                if (dup)
                    return dup;
            }
            throw err;
        }
        if (users && !store.insertNoticeWithDeliveries)
            await store.insertDeliveries(deliveryRows(notice.id, users, t));
        await emit({ type: "created", notice, actor });
        if (publish) {
            await emit({ type: "published", notice, actor });
            await invalidate(notice);
        }
        return notice;
    }
    async function update(id, patch, actor) {
        const cur = await mustGet(id);
        if (cur.status === "revoked")
            throw new TongzhiError("INVALID_STATE", "已撤回的通知不能修改");
        const fields = applyPatch(cur, patch);
        if (fields.idemKey && fields.idemKey !== cur.idemKey) {
            const dup = await store.findByIdemKey(fields.idemKey);
            if (dup && dup.id !== id)
                throw new TongzhiError("INVALID_INPUT", "idemKey 已被别的通知占用");
        }
        const next = await store.updateNotice(id, { ...fields, updatedAt: now() });
        if (!next)
            throw new TongzhiError("NOT_FOUND", `通知不存在: ${id}`);
        if (patch.audience && next.audience.type === "users") {
            // 原子替换(一条语句)优先;两步写半途失败时,用同一 patch 重试 update 会再跑一遍补齐
            if (store.replaceDeliveries)
                await store.replaceDeliveries(id, next.audience.userIds, now());
            else {
                await store.insertDeliveries(deliveryRows(id, next.audience.userIds, now()));
                await store.pruneDeliveries(id, next.audience.userIds);
            }
        }
        await emit({ type: "updated", notice: next, actor });
        if (next.status === "published")
            await invalidate(next);
        return next;
    }
    return { create, update };
}
/** 管理侧:状态机(发布 / 撤回 / 整批撤回 / 删除) */
function noticeStateOps(c) {
    const { store, now, realtime, emit, invalidate, mustGet } = c;
    async function publish(id, actor) {
        const cur = await mustGet(id);
        if (cur.status === "revoked")
            throw new TongzhiError("INVALID_STATE", "已撤回的通知不能再发布");
        if (cur.status === "published")
            return cur;
        const t = now();
        const next = await store.updateNotice(id, { status: "published", publishedAt: t, updatedAt: t });
        if (!next)
            throw new TongzhiError("INVALID_STATE", "通知已被撤回,不能发布");
        await emit({ type: "published", notice: next, actor });
        await invalidate(next);
        return next;
    }
    async function revoke(id, actor) {
        const cur = await mustGet(id);
        if (cur.status === "revoked")
            return cur;
        const t = now();
        // 保持原语义:store 返回 null 时照旧往下走(emit / invalidate 各自吞错),不在这里新增抛错
        const next = (await store.updateNotice(id, { status: "revoked", revokedAt: t, updatedAt: t }));
        await emit({ type: "revoked", notice: next, actor });
        await invalidate(next);
        return next;
    }
    async function revokeBatch(batchId, actor, opt = {}) {
        if (!batchId?.trim())
            throw new TongzhiError("INVALID_INPUT", "batchId 不能为空");
        const t = now();
        const count = await store.updateBatchStatus(batchId, { status: "revoked", revokedAt: t, updatedAt: t }, opt.source);
        await emit({ type: "batch_revoked", batchId, count, actor });
        try {
            await realtime.invalidate(null);
        }
        catch { /* noop */ }
        return count;
    }
    async function remove(id, actor) {
        const cur = await mustGet(id);
        if (cur.status === "published" && phaseOf(cur, now()) === "live")
            throw new TongzhiError("INVALID_STATE", "生效中的通知先撤回再删除");
        const ok = await store.deleteNotice(id);
        if (ok)
            await emit({ type: "removed", noticeId: id, actor });
        return ok;
    }
    return { publish, revoke, revokeBatch, remove };
}
/** 业务侧定向发送 + 管理侧预览 */
function sendOps(c) {
    const { opts, store, now, newId, realtime, emit } = c;
    /** 业务代码定向发送:一条通知 + N 行投递;默认直接 published;idemKey 强烈建议给 */
    async function send(input, actor = { id: "system", source: "api" }) {
        const userIds = Array.from(new Set([...(input.userIds ?? []), ...(input.userId ? [input.userId] : [])].map((s) => String(s).trim()).filter(Boolean)));
        if (!userIds.length)
            throw new TongzhiError("INVALID_INPUT", "send 需要 userId 或 userIds");
        const { userId: _u, userIds: _us, payloads, ...rest } = input;
        const fields = normalizeInput({ ...rest, audience: { type: "users", userIds }, surfaces: rest.surfaces ?? ["inbox", "toast"] });
        // 已发布 / 已撤回的直接返回;留在 draft 的是上次投递半途失败的那条,接着补齐再发布
        let existing = null;
        if (fields.idemKey) {
            existing = await store.findByIdemKey(fields.idemKey);
            if (existing && existing.status !== "draft")
                return existing;
        }
        const t = now();
        // 先 draft → 投递全部落库 → 再翻成 published:半途失败不会出现「已发布但只投了一部分」;idemKey 重跑时 draft 会被回读并补齐
        const draft = {
            ...fields, id: newId(), status: "draft", source: actor.source ?? "api", createdBy: actor.id,
            createdAt: t, updatedAt: t, publishedAt: null, revokedAt: null,
        };
        let notice = existing ?? draft;
        if (!existing) {
            try {
                await store.insertNotice(draft);
            }
            catch (err) {
                if (fields.idemKey && isUniqueViolation(err)) {
                    const dup = await store.findByIdemKey(fields.idemKey);
                    if (dup && dup.status !== "draft")
                        return dup;
                    if (dup)
                        notice = dup;
                    else
                        throw err;
                }
                else
                    throw err;
            }
        }
        await store.insertDeliveries(userIds.map((userId) => ({ noticeId: notice.id, userId, payload: payloads?.[userId] ?? null, createdAt: t })));
        notice = (await store.updateNotice(notice.id, { status: "published", publishedAt: t, updatedAt: t })) ?? notice;
        await emit({ type: "sent", notice, userIds, actor });
        try {
            await realtime.invalidate(userIds);
        }
        catch { /* noop */ }
        return notice;
    }
    async function preview(input) {
        const fields = normalizeInput(input);
        const t = now();
        const warnings = [];
        if (fields.surfaces.includes("modal") && fields.frequency === "every" && fields.maxPopups === 0)
            warnings.push("弹窗设了「每次进站」且不封顶,玩家每次打开都会被弹");
        if (fields.surfaces.includes("marquee") && !fields.endAt)
            warnings.push("跑马灯没设过期时间,会一直滚");
        if (fields.surfaces.includes("banner") && !fields.endAt)
            warnings.push("横幅没设过期时间,会一直挂着");
        if (fields.forceRead && !fields.surfaces.includes("modal"))
            warnings.push("forceRead 只对弹窗有意义");
        if (!fields.body.trim())
            warnings.push("正文为空");
        const audienceCount = opts.countAudience ? await opts.countAudience(fields.audience) : fields.audience.type === "users" ? fields.audience.userIds.length : null;
        return {
            notice: fields,
            summary: plainText(fields.body || fields.title),
            phaseIfPublishedNow: phaseOf({ status: "published", startAt: fields.startAt, endAt: fields.endAt }, t),
            audienceCount,
            warnings,
        };
    }
    return { send, preview };
}
/** 玩家侧:首屏 bundle / feed / 回执 */
function playerOps(c) {
    const { store, now, tz } = c;
    // 已读变了只通知本人;推送失败不影响已读本身
    const touched = async (userId) => { if (c.opts.invalidateOnRead) {
        try {
            await c.realtime.invalidate([userId]);
        }
        catch { /* 实时是锦上添花 */ }
    } };
    /** 一次拿齐首屏要的全部:未读数 + 收件箱前 N + 该弹的弹窗 + 跑马灯 + 横幅 + 待 toast */
    async function bundle(ctx, opt = {}) {
        const t = now();
        // 两条 SQL:一次取齐五个面的可见集(上限 100,按面在内存里切),外加一条未读数(它要看全部收件箱,不受上限影响)
        const [unread, all] = await Promise.all([
            store.countUnread(ctx, t),
            store.listFeed(ctx, { surfaces: ["inbox", "modal", "marquee", "banner", "toast"], includeArchived: true, limit: 100, cursor: null }, t),
        ]);
        const items = all.items.filter((it) => !it.receipt?.archivedAt);
        const has = (it, s) => it.notice.surfaces.includes(s);
        const windowMs = opt.toastWindowMs ?? 10 * 60_000;
        return {
            unread,
            inbox: items.filter((it) => has(it, "inbox")).slice(0, clampLimit(opt.inboxLimit, 10, 50)),
            popups: items.filter((it) => has(it, "modal") && shouldPopup(it.notice, it.receipt, t, tz)).slice(0, 20),
            marquee: items.filter((it) => has(it, "marquee") && !isDismissed(it.receipt, t)).slice(0, 20),
            banners: items.filter((it) => has(it, "banner") && !isDismissed(it.receipt, t)).slice(0, 5),
            toasts: items.filter((it) => has(it, "toast") && !it.receipt?.readAt && !it.receipt?.seenAt && (it.notice.publishedAt ?? it.notice.createdAt).getTime() > t.getTime() - windowMs).slice(0, 5),
        };
    }
    const feed = (ctx, q = {}) => store.listFeed(ctx, q, now());
    const unreadCount = (ctx) => store.countUnread(ctx, now());
    const markSeen = (userId, ids) => store.touchReceipts(userId, uniq(ids), { seenAt: now() });
    const markRead = async (userId, ids) => { const t = now(); await store.touchReceipts(userId, uniq(ids), { readAt: t, seenAt: t }); await touched(userId); };
    const markAllRead = async (ctx) => { const r = await store.markAllRead(ctx, now()); await touched(ctx.userId); return r; };
    const archive = async (userId, ids) => { const t = now(); await store.touchReceipts(userId, uniq(ids), { archivedAt: t, readAt: t, seenAt: t }); await touched(userId); };
    /** 「今日不再提示」/ 关掉横幅:默认到本地明天 0 点;hours 给了按小时 */
    const dismiss = async (userId, id, opt = {}) => {
        const t = now();
        const until = opt.hours ? new Date(t.getTime() + opt.hours * 3_600_000) : nextLocalMidnight(t, tz);
        await store.touchReceipts(userId, [id], { dismissedUntil: until, seenAt: t });
        return until;
    };
    const popupShown = (userId, id) => store.bumpPopup(id, userId, now());
    return { bundle, feed, unreadCount, markSeen, markRead, markAllRead, archive, dismiss, popupShown };
}
/** 管理侧:查询 / 统计 / 清理 / 模板 */
function queryOps(c) {
    const { store, now, templates, emit } = c;
    const list = (filter = {}) => store.listNotices(filter, now());
    const stats = (id) => store.stats(id);
    /**
     * 各阶段条数。store 实现了 countByPhase 就一次聚合(exact=true);
     * 否则回落老写法:每阶段最多数 100 条(exact=false,超过 100 的显示 100)。
     */
    async function countByPhase() {
        const t = now();
        if (store.countByPhase)
            return { counts: await store.countByPhase(t), exact: true };
        const counts = { draft: 0, scheduled: 0, live: 0, expired: 0, revoked: 0 };
        for (const phase of NOTICE_PHASES)
            counts[phase] = (await store.listNotices({ phase, limit: 100 }, t)).items.length;
        return { counts, exact: false };
    }
    async function purge(opt = {}, actor = { id: "system", source: "cron" }) {
        const days = opt.olderThanDays ?? 90;
        const before = new Date(now().getTime() - days * 86_400_000);
        const count = await store.purge(before);
        await emit({ type: "purged", count, before, actor });
        return { count, before };
    }
    const fromTemplate = (key, vars = {}) => {
        const t = templates.find((x) => x.key === key);
        if (!t)
            throw new TongzhiError("NOT_FOUND", `模板不存在: ${key}`);
        return applyTemplate(t, vars);
    };
    return { list, stats, countByPhase, purge, fromTemplate };
}
export function createTongzhi(opts) {
    const c = createCore(opts);
    const { now, templates } = c;
    const { create, update } = noticeWriteOps(c);
    const { publish, revoke, revokeBatch, remove } = noticeStateOps(c);
    const { send, preview } = sendOps(c);
    const { bundle, feed, unreadCount, markSeen, markRead, markAllRead, archive, dismiss, popupShown } = playerOps(c);
    const { list, stats, countByPhase, purge, fromTemplate } = queryOps(c);
    const get = c.mustGet;
    return {
        create, update, publish, revoke, revokeBatch, remove, send, preview, get, list, stats, countByPhase, purge,
        bundle, feed, unreadCount, markSeen, markRead, markAllRead, archive, dismiss, popupShown,
        templates: () => templates, fromTemplate,
        newBatchId,
        now,
    };
}
const uniq = (ids) => Array.from(new Set(ids.map((s) => String(s).trim()).filter(Boolean)));
function isUniqueViolation(err) {
    const code = err?.code ?? err?.cause?.code;
    return code === "23505" || /unique|duplicate/i.test(String(err?.message ?? ""));
}
export function nextLocalMidnight(t, tzOffsetMin) {
    const shifted = t.getTime() + tzOffsetMin * 60_000;
    const dayStart = Math.floor(shifted / 86_400_000) * 86_400_000;
    return new Date(dayStart + 86_400_000 - tzOffsetMin * 60_000);
}
/** 定向投递行(payload 为空的那种:create / update 用;send 自带 payload 另拼) */
function deliveryRows(noticeId, userIds, createdAt) {
    return userIds.map((userId) => ({ noticeId, userId, payload: null, createdAt }));
}
