import { withErrorKinds } from "./http/error-kind.js";
import { HTTP_STATUS_BY_CODE } from "./http/wire.js";
import { ZhanghaoError, isZhanghaoError } from "./types.js";
import { yuanToCents, } from "./recharge-adjustments.js";
export function adjustmentView(r) {
    return {
        id: r.id,
        userId: r.userId,
        amountCents: r.amountCents.toString(),
        reason: r.reason,
        status: r.status,
        revision: r.revision,
        requestId: r.requestId,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        updatedBy: r.updatedBy,
        updatedAt: r.updatedAt.toISOString(),
        revokedBy: r.revokedBy,
        revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
        revokeReason: r.revokeReason,
    };
}
export function adjustmentEventView(e) {
    return { ...e, createdAt: e.createdAt.toISOString() };
}
/* ────────────────────────────── 路由表 ────────────────────────────── */
export const RECHARGE_ADJUSTMENT_ROUTES = [
    { key: "adminRechargeAdjustments", method: "GET", path: "/admin/users/:id/recharge-adjustments", auth: "admin" },
    { key: "adminCreateRechargeAdjustment", method: "POST", path: "/admin/users/:id/recharge-adjustments", auth: "admin" },
    { key: "adminUpdateRechargeAdjustment", method: "PATCH", path: "/admin/recharge-adjustments/:id", auth: "admin" },
    { key: "adminRevokeRechargeAdjustment", method: "POST", path: "/admin/recharge-adjustments/:id/revoke", auth: "admin" },
    { key: "adminRechargeAdjustmentEvents", method: "GET", path: "/admin/users/:id/recharge-adjustment-events", auth: "admin" },
];
function fail(message, field) {
    throw new ZhanghaoError("VALIDATION", message, { field });
}
function asObject(body) {
    return body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
}
function requireAdmin(input) {
    const auth = input.auth;
    if (!auth?.userId)
        throw new ZhanghaoError("TOKEN_INVALID", "未登录");
    if (auth.role !== "admin")
        throw new ZhanghaoError("FORBIDDEN", "需要管理员权限");
    return auth;
}
function requireId(input) {
    const id = input.params?.id;
    if (!id)
        fail("缺少路径参数 id", "id");
    return id;
}
function ctxOf(input, auth) {
    const body = asObject(input.body);
    const raw = input.requestId ?? (typeof body.requestId === "string" ? body.requestId : undefined);
    if (!raw?.trim())
        fail("后台动作必须带 requestId(幂等锚)", "requestId");
    return { operatorId: auth.userId, requestId: raw };
}
/** 从 body 里读金额:amountCents(整数分字符串 / 安全整数)或 amountYuan(元字符串);都没有返回 undefined */
export function amountFromBody(body) {
    const rawCents = body.amountCents;
    const rawYuan = body.amountYuan;
    let cents;
    if (rawCents !== undefined && rawCents !== null && rawCents !== "") {
        if (typeof rawCents === "string" && /^[+-]?\d+$/.test(rawCents.trim()))
            cents = BigInt(rawCents.trim());
        else if (typeof rawCents === "number" && Number.isSafeInteger(rawCents))
            cents = BigInt(rawCents);
        else
            fail("amountCents 必须是整数分(字符串)", "amountCents");
    }
    if (rawYuan !== undefined && rawYuan !== null && rawYuan !== "") {
        const y = typeof rawYuan === "string" ? yuanToCents(rawYuan) : null;
        if (y === null)
            fail("金额格式不对:最多两位小数,例如 100 或 -20.50", "amountYuan");
        if (cents !== undefined && cents !== y)
            fail("amountCents 与 amountYuan 不一致", "amountYuan");
        cents = y;
    }
    return cents;
}
function revisionFromBody(body) {
    const v = body.expectedRevision;
    const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1)
        fail("缺少 expectedRevision", "expectedRevision");
    return n;
}
function str(body, key) {
    const v = body[key];
    if (v === undefined || v === null)
        return undefined;
    if (typeof v !== "string")
        fail(`${key} 必须是字符串`, key);
    return v;
}
/** 处理器共用的出错口 / 操作人显示名;只依赖 opts,与处理器表分开放只为把工厂拆短 */
function helpersFor(opts) {
    function toError(err, key) {
        if (isZhanghaoError(err) && HTTP_STATUS_BY_CODE[err.code] !== undefined) {
            const body = { code: err.code, message: err.message };
            if (err.detail)
                body.detail = err.detail;
            return { status: HTTP_STATUS_BY_CODE[err.code], body };
        }
        opts.onInternalError?.(err, key);
        return { status: 500, body: { code: "INTERNAL", message: "服务暂时不可用" } };
    }
    function guard(key, fn) {
        return fn().catch((err) => toError(err, key));
    }
    async function namesFor(ids) {
        if (!opts.operatorNames)
            return new Map();
        const uniq = [...new Set(ids.filter((x) => !!x))];
        if (uniq.length === 0)
            return new Map();
        try {
            return await opts.operatorNames(uniq);
        }
        catch {
            return new Map(); // 显示名只是锦上添花,查不到不影响主流程
        }
    }
    function named(v, names) {
        if (!opts.operatorNames)
            return v;
        return {
            ...v,
            createdByName: names.get(v.createdBy) ?? null,
            updatedByName: v.updatedBy ? (names.get(v.updatedBy) ?? null) : null,
            revokedByName: v.revokedBy ? (names.get(v.revokedBy) ?? null) : null,
        };
    }
    async function resultView(r) {
        const v = adjustmentView(r.row);
        const names = await namesFor([v.createdBy, v.updatedBy, v.revokedBy]);
        return { item: named(v, names), replayed: r.replayed };
    }
    return { guard, namesFor, named, resultView };
}
function buildRechargeAdjustmentHandlers(svc, opts = {}) {
    const { guard, namesFor, named, resultView } = helpersFor(opts);
    return {
        adminRechargeAdjustments(input) {
            return guard("adminRechargeAdjustments", async () => {
                requireAdmin(input);
                const userId = requireId(input);
                const [items, adj, real] = await Promise.all([
                    svc.list(userId, { includeRevoked: true }),
                    svc.sumActive(userId),
                    opts.realRechargeCents ? opts.realRechargeCents(userId) : Promise.resolve(null),
                ]);
                const eff = real === null ? null : real + adj < 0n ? 0n : real + adj;
                const views = items.map(adjustmentView);
                const names = await namesFor(views.flatMap((v) => [v.createdBy, v.updatedBy, v.revokedBy]));
                return {
                    status: 200,
                    body: {
                        userId,
                        realCents: real === null ? null : real.toString(),
                        adjustmentCents: adj.toString(),
                        effectiveCents: eff === null ? null : eff.toString(),
                        items: views.map((v) => named(v, names)),
                    },
                };
            });
        },
        adminCreateRechargeAdjustment(input) {
            return guard("adminCreateRechargeAdjustment", async () => {
                const auth = requireAdmin(input);
                const userId = requireId(input);
                const body = asObject(input.body);
                const ctx = ctxOf(input, auth);
                const amountCents = amountFromBody(body);
                if (amountCents === undefined)
                    fail("缺少金额", "amountCents");
                const r = await svc.create({ userId, amountCents, reason: str(body, "reason") ?? "" }, ctx);
                return { status: r.replayed ? 200 : 201, body: await resultView(r) };
            });
        },
        adminUpdateRechargeAdjustment(input) {
            return guard("adminUpdateRechargeAdjustment", async () => {
                const auth = requireAdmin(input);
                const id = requireId(input);
                const body = asObject(input.body);
                const ctx = ctxOf(input, auth);
                const amountCents = amountFromBody(body);
                const reason = str(body, "reason");
                const r = await svc.update(id, { ...(amountCents !== undefined ? { amountCents } : {}), ...(reason !== undefined ? { reason } : {}), expectedRevision: revisionFromBody(body) }, ctx);
                return { status: 200, body: await resultView(r) };
            });
        },
        adminRevokeRechargeAdjustment(input) {
            return guard("adminRevokeRechargeAdjustment", async () => {
                const auth = requireAdmin(input);
                const id = requireId(input);
                const body = asObject(input.body);
                const ctx = ctxOf(input, auth);
                const r = await svc.revoke(id, { reason: str(body, "reason") ?? "", expectedRevision: revisionFromBody(body) }, ctx);
                return { status: 200, body: await resultView(r) };
            });
        },
        adminRechargeAdjustmentEvents(input) {
            return guard("adminRechargeAdjustmentEvents", async () => {
                requireAdmin(input);
                const userId = requireId(input);
                const q = input.query ?? {};
                const limitRaw = q.limit;
                if (limitRaw !== undefined && limitRaw !== "" && !/^\d+$/.test(limitRaw))
                    fail("limit 必须是整数", "limit");
                const rows = await svc.events(userId, {
                    ...(q.beforeId ? { beforeId: q.beforeId } : {}),
                    ...(limitRaw ? { limit: Number(limitRaw) } : {}),
                });
                const evs = rows.map(adjustmentEventView);
                const names = await namesFor(evs.map((e) => e.operatorId));
                return {
                    status: 200,
                    body: { items: opts.operatorNames ? evs.map((e) => ({ ...e, operatorName: names.get(e.operatorId) ?? null })) : evs },
                };
            });
        },
    };
}
/** 对外的处理器：错误体统一带 kind（error-kind.ts，公司基础契约 jichu 的 ErrorBody） */
export function createRechargeAdjustmentHandlers(svc, opts = {}) {
    return withErrorKinds(buildRechargeAdjustmentHandlers(svc, opts));
}
