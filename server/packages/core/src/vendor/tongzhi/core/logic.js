/**
 * 纯逻辑内核(零 I/O):输入归一化与校验、生效窗口、阶段派生、受众裁决、弹窗频控。
 * service / store / 前端 都从这里取同一份判定,别在别处再写一份。
 */
import { AUDIENCE_TYPES, FREQUENCY_MODES, NOTICE_KINDS, SEVERITIES, SURFACES, TongzhiError, } from "../types.js";
export const DEFAULTS = {
    kind: "system",
    severity: "normal",
    surfaces: ["inbox"],
    frequency: "once",
    frequencyHours: 24,
    maxPopups: 1,
    sortOrder: 0,
};
export const LIMITS = {
    title: 120,
    body: 20_000,
    actions: 2,
    actionLabel: 24,
    audienceValues: 5_000,
    idemKey: 128,
    batchId: 64,
};
const isStr = (v) => typeof v === "string";
const oneOf = (list, v) => isStr(v) && list.includes(v);
export function toDateOrNull(v, field) {
    if (v == null || v === "")
        return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime()))
        throw new TongzhiError("INVALID_INPUT", `${field} 不是合法时间`);
    return d;
}
function cleanStringList(v, field) {
    if (!Array.isArray(v))
        throw new TongzhiError("INVALID_INPUT", `${field} 必须是字符串数组`);
    const out = Array.from(new Set(v.map((x) => (isStr(x) ? x.trim() : "")).filter(Boolean)));
    if (!out.length)
        throw new TongzhiError("INVALID_INPUT", `${field} 不能为空`);
    if (out.length > LIMITS.audienceValues)
        throw new TongzhiError("INVALID_INPUT", `${field} 超过 ${LIMITS.audienceValues} 个`);
    return out;
}
export function normalizeAudience(v) {
    if (v == null)
        return { type: "all" };
    const a = v;
    if (!oneOf(AUDIENCE_TYPES, a.type))
        throw new TongzhiError("INVALID_INPUT", `audience.type 只能是 ${AUDIENCE_TYPES.join(" / ")}`);
    switch (a.type) {
        case "all": return { type: "all" };
        case "users": return { type: "users", userIds: cleanStringList(a.userIds, "audience.userIds") };
        case "tiers": return { type: "tiers", tiers: cleanStringList(a.tiers, "audience.tiers") };
        case "tags": return { type: "tags", tags: cleanStringList(a.tags, "audience.tags") };
        case "roles": return { type: "roles", roles: cleanStringList(a.roles, "audience.roles") };
    }
}
/** 受众里的值列表(存储用 text[]);all = [] */
export function audienceValues(a) {
    switch (a.type) {
        case "all": return [];
        case "users": return a.userIds;
        case "tiers": return a.tiers;
        case "tags": return a.tags;
        case "roles": return a.roles;
    }
}
export function audienceFromParts(type, values) {
    switch (type) {
        case "users": return { type, userIds: values };
        case "tiers": return { type, tiers: values };
        case "tags": return { type, tags: values };
        case "roles": return { type, roles: values };
        default: return { type: "all" };
    }
}
export function normalizeActions(v) {
    if (v == null)
        return [];
    if (!Array.isArray(v))
        throw new TongzhiError("INVALID_INPUT", "actions 必须是数组");
    if (v.length > LIMITS.actions)
        throw new TongzhiError("INVALID_INPUT", `actions 最多 ${LIMITS.actions} 个`);
    return v.map((x, i) => {
        const a = x;
        const label = isStr(a?.label) ? a.label.trim() : "";
        const url = isStr(a?.url) ? a.url.trim() : "";
        if (!label || label.length > LIMITS.actionLabel)
            throw new TongzhiError("INVALID_INPUT", `actions[${i}].label 为空或超过 ${LIMITS.actionLabel} 字`);
        if (!isSafeUrl(url))
            throw new TongzhiError("INVALID_INPUT", `actions[${i}].url 只允许 / 开头的站内路径或 http(s) 链接`);
        const style = a.style === "secondary" ? "secondary" : "primary";
        return { label, url, style };
    });
}
/** 只放行站内相对路径与 http(s);javascript:/data: 一类一律拒 */
export function isSafeUrl(url) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 故意匹配控制字符——URL 里带 \u0000-\u001f / \u007f 一律判不安全(防协议走私 / 头注入)
    if (!url || /[\u0000-\u001f\u007f]/.test(url))
        return false;
    // 站内路径:/ 开头且第二个字符不是 / 或 \(浏览器把 \ 规范化成 /,`/\evil.com` = 协议相对 = 开放重定向)
    if (url.startsWith("/"))
        return !/^\/[/\\]/.test(url) && !url.includes("\\");
    return /^https?:\/\/[^\s\\]+$/i.test(url);
}
/** 输入 → 可入库的字段集(不含 id / 时间戳 / 状态);全部校验在此 */
export function normalizeInput(raw) {
    const title = isStr(raw.title) ? raw.title.trim() : "";
    if (!title)
        throw new TongzhiError("INVALID_INPUT", "title 不能为空");
    if (title.length > LIMITS.title)
        throw new TongzhiError("INVALID_INPUT", `title 超过 ${LIMITS.title} 字`);
    const body = isStr(raw.body) ? raw.body : "";
    if (body.length > LIMITS.body)
        throw new TongzhiError("INVALID_INPUT", `body 超过 ${LIMITS.body} 字`);
    const kind = raw.kind ?? DEFAULTS.kind;
    if (!oneOf(NOTICE_KINDS, kind))
        throw new TongzhiError("INVALID_INPUT", `kind 只能是 ${NOTICE_KINDS.join(" / ")}`);
    const severity = raw.severity ?? DEFAULTS.severity;
    if (!oneOf(SEVERITIES, severity))
        throw new TongzhiError("INVALID_INPUT", `severity 只能是 ${SEVERITIES.join(" / ")}`);
    const surfacesRaw = raw.surfaces ?? DEFAULTS.surfaces;
    if (!Array.isArray(surfacesRaw) || !surfacesRaw.length)
        throw new TongzhiError("INVALID_INPUT", "surfaces 至少勾一个");
    const surfaces = Array.from(new Set(surfacesRaw));
    for (const s of surfaces)
        if (!oneOf(SURFACES, s))
            throw new TongzhiError("INVALID_INPUT", `surfaces 只能是 ${SURFACES.join(" / ")}`);
    const frequency = raw.frequency ?? DEFAULTS.frequency;
    if (!oneOf(FREQUENCY_MODES, frequency))
        throw new TongzhiError("INVALID_INPUT", `frequency 只能是 ${FREQUENCY_MODES.join(" / ")}`);
    const frequencyHours = raw.frequencyHours ?? DEFAULTS.frequencyHours;
    if (!Number.isInteger(frequencyHours) || frequencyHours < 1 || frequencyHours > 24 * 365)
        throw new TongzhiError("INVALID_INPUT", "frequencyHours 必须是 1 ~ 8760 的整数");
    const maxPopups = raw.maxPopups ?? DEFAULTS.maxPopups;
    if (!Number.isInteger(maxPopups) || maxPopups < 0 || maxPopups > 1000)
        throw new TongzhiError("INVALID_INPUT", "maxPopups 必须是 0 ~ 1000 的整数(0 = 不限)");
    const sortOrder = raw.sortOrder ?? DEFAULTS.sortOrder;
    if (!Number.isInteger(sortOrder))
        throw new TongzhiError("INVALID_INPUT", "sortOrder 必须是整数");
    const startAt = toDateOrNull(raw.startAt, "startAt");
    const endAt = toDateOrNull(raw.endAt, "endAt");
    if (startAt && endAt && endAt <= startAt)
        throw new TongzhiError("INVALID_INPUT", "endAt 必须晚于 startAt");
    const cover = raw.cover == null || raw.cover === "" ? null : String(raw.cover).trim();
    if (cover && !isSafeUrl(cover))
        throw new TongzhiError("INVALID_INPUT", "cover 只允许站内路径或 http(s) 链接");
    const icon = raw.icon == null || raw.icon === "" ? null : String(raw.icon).trim().slice(0, 40);
    const idemKey = raw.idemKey == null || raw.idemKey === "" ? null : String(raw.idemKey).trim();
    if (idemKey && idemKey.length > LIMITS.idemKey)
        throw new TongzhiError("INVALID_INPUT", `idemKey 超过 ${LIMITS.idemKey} 字`);
    const batchId = raw.batchId == null || raw.batchId === "" ? null : String(raw.batchId).trim();
    if (batchId && batchId.length > LIMITS.batchId)
        throw new TongzhiError("INVALID_INPUT", `batchId 超过 ${LIMITS.batchId} 字`);
    const meta = raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta) ? { ...raw.meta } : {};
    return {
        kind, severity, surfaces, title, body, cover, icon,
        actions: normalizeActions(raw.actions),
        audience: normalizeAudience(raw.audience),
        startAt, endAt,
        pinned: Boolean(raw.pinned),
        sortOrder, frequency, frequencyHours, maxPopups,
        forceRead: Boolean(raw.forceRead),
        closable: raw.closable == null ? true : Boolean(raw.closable),
        idemKey, batchId, meta,
    };
}
/** 局部更新:把 patch 叠在已有 notice 上再整体校验(改一个字段也走全量校验,省得两套规则) */
export function applyPatch(notice, patch) {
    const merged = {
        kind: patch.kind ?? notice.kind,
        severity: patch.severity ?? notice.severity,
        surfaces: patch.surfaces ?? notice.surfaces,
        title: patch.title ?? notice.title,
        body: patch.body ?? notice.body,
        cover: patch.cover === undefined ? notice.cover : patch.cover,
        icon: patch.icon === undefined ? notice.icon : patch.icon,
        actions: patch.actions ?? notice.actions,
        audience: patch.audience ?? notice.audience,
        startAt: patch.startAt === undefined ? notice.startAt : patch.startAt,
        endAt: patch.endAt === undefined ? notice.endAt : patch.endAt,
        pinned: patch.pinned ?? notice.pinned,
        sortOrder: patch.sortOrder ?? notice.sortOrder,
        frequency: patch.frequency ?? notice.frequency,
        frequencyHours: patch.frequencyHours ?? notice.frequencyHours,
        maxPopups: patch.maxPopups ?? notice.maxPopups,
        forceRead: patch.forceRead ?? notice.forceRead,
        closable: patch.closable ?? notice.closable,
        idemKey: patch.idemKey === undefined ? notice.idemKey : patch.idemKey,
        batchId: patch.batchId === undefined ? notice.batchId : patch.batchId,
        meta: patch.meta ?? notice.meta,
    };
    return normalizeInput(merged);
}
/** 此刻是否在生效窗口内(不看 status) */
export function isWithinWindow(n, now) {
    if (n.startAt && n.startAt > now)
        return false;
    if (n.endAt && n.endAt <= now)
        return false;
    return true;
}
export function isLive(n, now) {
    return n.status === "published" && isWithinWindow(n, now);
}
export function phaseOf(n, now) {
    if (n.status === "revoked")
        return "revoked";
    if (n.status === "draft")
        return "draft";
    if (n.startAt && n.startAt > now)
        return "scheduled";
    if (n.endAt && n.endAt <= now)
        return "expired";
    return "live";
}
/** 受众裁决(users 型在 store 里靠 delivery 索引裁,这里只处理属性型;users 型给 true 交给索引) */
export function matchesAudience(a, ctx) {
    switch (a.type) {
        case "all": return true;
        case "users": return a.userIds.includes(ctx.userId);
        case "tiers": return ctx.tier != null && a.tiers.includes(ctx.tier);
        case "tags": return (ctx.tags ?? []).some((t) => a.tags.includes(t));
        case "roles": return (ctx.roles ?? []).some((r) => a.roles.includes(r));
    }
}
const DAY_MS = 86_400_000;
/** 按本地(宿主传的 tzOffsetMin)切「今天」;默认 UTC+8(生态各站都是国内玩家) */
export function dayKey(d, tzOffsetMin = 480) {
    return Math.floor((d.getTime() + tzOffsetMin * 60_000) / DAY_MS);
}
/**
 * 弹窗频控 —— 唯一真相:
 *   once  : 弹过就不弹(maxPopups 生效)
 *   every : 每次进站都弹(maxPopups=0 不限,否则封顶)
 *   daily : 上次弹的不是今天就弹;maxPopups 封顶
 *   gap   : 距上次 ≥ frequencyHours 小时就弹;maxPopups 封顶
 * 已 archived / 点了「我已阅读」(readAt 且 forceRead) / dismissedUntil 未到 ⇒ 不弹。
 */
export function shouldPopup(n, r, now, tzOffsetMin = 480) {
    if (!n.surfaces.includes("modal"))
        return false;
    if (!r)
        return true;
    if (r.archivedAt)
        return false;
    if (r.dismissedUntil && r.dismissedUntil > now)
        return false;
    const count = r.popupCount;
    const capped = n.maxPopups > 0 && count >= n.maxPopups;
    switch (n.frequency) {
        case "once": return count === 0 && !r.readAt;
        case "every": return !capped;
        case "daily": {
            if (capped)
                return false;
            if (!r.lastPopupAt)
                return true;
            return dayKey(r.lastPopupAt, tzOffsetMin) !== dayKey(now, tzOffsetMin);
        }
        case "gap": {
            if (capped)
                return false;
            if (!r.lastPopupAt)
                return true;
            return now.getTime() - r.lastPopupAt.getTime() >= n.frequencyHours * 3_600_000;
        }
    }
}
/** 横幅/跑马灯是否被本人临时关掉 */
export function isDismissed(r, now) {
    return Boolean(r && ((r.dismissedUntil && r.dismissedUntil > now) || r.archivedAt));
}
export function isUnread(r) {
    return !r || (!r.readAt && !r.archivedAt);
}
/** 排序:置顶 > sortOrder 大 > 严重度高 > 发布时间新 */
const SEV_RANK = { critical: 3, high: 2, normal: 1, low: 0 };
export function compareNotices(a, b) {
    if (a.pinned !== b.pinned)
        return a.pinned ? -1 : 1;
    if (a.sortOrder !== b.sortOrder)
        return b.sortOrder - a.sortOrder;
    if (SEV_RANK[a.severity] !== SEV_RANK[b.severity])
        return SEV_RANK[b.severity] - SEV_RANK[a.severity];
    const ta = (a.publishedAt ?? a.createdAt).getTime();
    const tb = (b.publishedAt ?? b.createdAt).getTime();
    if (ta !== tb)
        return tb - ta;
    return a.id < b.id ? 1 : -1;
}
/** PG text[] 字面量(给 `$n::text[]` 用;跨 pg / postgres.js / Prisma 都稳,不依赖驱动的数组序列化) */
export function pgArrayLiteral(values) {
    return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}
/** offset 型游标(通知列表很小,不做 keyset) */
export function decodeCursor(c) {
    if (!c)
        return 0;
    const n = Number(c);
    return Number.isInteger(n) && n >= 0 ? n : 0;
}
export function encodeCursor(offset, pageLen, limit) {
    return pageLen < limit ? null : String(offset + pageLen);
}
export function clampLimit(v, def = 20, max = 100) {
    if (!Number.isFinite(v))
        return def;
    return Math.min(max, Math.max(1, Math.trunc(v)));
}
/** 群发批次号 */
export function newBatchId(now = new Date()) {
    return `nb_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
/** 通知 → JSON 安全的 wire 形状(Date → ISO) */
export function noticeToWire(n, now = new Date()) {
    return {
        ...n,
        phase: phaseOf(n, now),
        startAt: n.startAt?.toISOString() ?? null,
        endAt: n.endAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
        publishedAt: n.publishedAt?.toISOString() ?? null,
        revokedAt: n.revokedAt?.toISOString() ?? null,
    };
}
/** 玩家侧 wire:去掉管理字段(受众名单 / 操作者 / 幂等键 / 批次 / meta / 来源)—— 定向通知的收件人名单绝不能发给每个收件人 */
export function noticeToPlayerWire(n, now = new Date()) {
    const { audience: _a, createdBy: _c, idemKey: _i, batchId: _b, meta: _m, source: _s, ...rest } = noticeToWire(n, now);
    return rest;
}
export function receiptToWire(r) {
    if (!r)
        return null;
    return {
        seenAt: r.seenAt?.toISOString() ?? null,
        readAt: r.readAt?.toISOString() ?? null,
        archivedAt: r.archivedAt?.toISOString() ?? null,
        dismissedUntil: r.dismissedUntil?.toISOString() ?? null,
        popupCount: r.popupCount,
        lastPopupAt: r.lastPopupAt?.toISOString() ?? null,
    };
}
/** wire → Notice(浏览器端 / CLI 反序列化用) */
export function noticeFromWire(w) {
    const { phase: _phase, ...rest } = w;
    return {
        ...rest,
        startAt: w.startAt ? new Date(w.startAt) : null,
        endAt: w.endAt ? new Date(w.endAt) : null,
        createdAt: new Date(w.createdAt),
        updatedAt: new Date(w.updatedAt),
        publishedAt: w.publishedAt ? new Date(w.publishedAt) : null,
        revokedAt: w.revokedAt ? new Date(w.revokedAt) : null,
    };
}
