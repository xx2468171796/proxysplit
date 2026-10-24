import { FenxiaoError, FxErrorCodes } from "../types.js";
import { amount, asBody, handle, idOf, int, namesOf, oneOf, pageOf, reqOneOf, reqStr, str, sinceDays } from "./shared.js";
const C_STATUSES = ["frozen", "available", "held", "reversed"];
const W_STATUSES = ["pending", "paid", "rejected"];
const A_STATUSES = ["pending", "approved", "rejected"];
const optional = (k, v) => (v === undefined ? {} : { [k]: v });
function rateArray(b, k) {
    const v = b[k];
    if (v === undefined)
        return undefined;
    if (v === null)
        return null;
    if (!Array.isArray(v) || !v.every((x) => Number.isInteger(x)))
        throw new FenxiaoError(FxErrorCodes.INPUT_INVALID, `${k} 必须是整数数组(万分比)`);
    return v;
}
function memberPatch(b) {
    const tier = b.tierCode === null ? null : str(b, "tierCode", 32);
    const note = b.note === null ? null : str(b, "note", 200);
    return {
        ...optional("tierCode", tier),
        ...optional("enabled", typeof b.enabled === "boolean" ? b.enabled : undefined),
        ...optional("rateOverride", rateArray(b, "rateOverride")),
        ...optional("note", note),
        ...optional("code", str(b, "code", 16)),
    };
}
export function createAdminHandlers(fx, o = {}) {
    const now = o.now ?? (() => new Date());
    const run = (fn) => handle(o.logger, fn);
    const withNames = async (r, ids) => ({ ...r, users: await namesOf(o.names, ids, false) });
    return {
        overview: (query) => run(() => fx.overview(sinceDays(asBody(query), now(), 30))),
        leaderboard: (query) => run(async () => {
            const q = asBody(query);
            const items = await fx.leaderboard({ since: sinceDays(q, now(), 30), ...optional("limit", int(q, "limit")) });
            return { items, users: await namesOf(o.names, items.map((i) => i.userId), false) };
        }),
        members: (query) => run(async () => {
            const q = asBody(query);
            const search = str(q, "q", 64);
            const userIds = search && o.searchUsers ? await o.searchUsers(search) : undefined;
            const r = await fx.listMembers({
                ...pageOf(q),
                ...optional("agentsOnly", q.agentsOnly === true || q.agentsOnly === "1" ? true : undefined),
                ...optional("tierCode", str(q, "tierCode", 32)),
                ...optional("parentUserId", str(q, "parentUserId", 64)),
                ...optional("userIds", userIds),
            });
            return withNames(r, r.items.flatMap((m) => [m.userId, ...(m.parentUserId ? [m.parentUserId] : [])]));
        }),
        setMember: (operatorId, userId, body) => run(() => fx.setMember({ userId, operatorId, ...memberPatch(asBody(body)) })),
        /** { parentUserId: string | null } */
        moveMember: (operatorId, userId, body) => run(() => fx.moveMember({ userId, operatorId, parentUserId: str(asBody(body), "parentUserId", 64) ?? null })),
        commissions: (query) => run(async () => {
            const q = asBody(query);
            const r = await fx.listCommissions({
                ...pageOf(q),
                ...optional("status", oneOf(q, "status", C_STATUSES)),
                ...optional("beneficiaryUserId", str(q, "beneficiaryUserId", 64)),
                ...optional("buyerUserId", str(q, "buyerUserId", 64)),
                ...optional("sourceKind", str(q, "sourceKind", 32)),
                ...optional("sourceRef", str(q, "sourceRef", 64)),
                ...optional("productKey", str(q, "productKey", 64)),
            });
            return withNames(r, r.items.flatMap((c) => [c.buyerUserId, c.beneficiaryUserId]));
        }),
        /** { action: approve | void, note? } */
        reviewCommission: (operatorId, id, body) => run(() => {
            const b = asBody(body);
            return fx.reviewCommission({ id: idOf(id), operatorId, action: reqOneOf(b, "action", ["approve", "void"]), ...optional("note", str(b, "note")) });
        }),
        /** { userId, amount(可负), reason, ref? } */
        adjust: (operatorId, body) => run(() => {
            const b = asBody(body);
            return fx.adjust({ operatorId, userId: reqStr(b, "userId", 64), amount: amount(b, "amount"), reason: reqStr(b, "reason"), ...optional("ref", str(b, "ref", 64)) });
        }),
        withdrawals: (query) => run(async () => {
            const q = asBody(query);
            const r = await fx.listWithdrawals({ ...pageOf(q), ...optional("status", oneOf(q, "status", W_STATUSES)), ...optional("userId", str(q, "userId", 64)) });
            return withNames(r, r.items.map((w) => w.userId));
        }),
        /** { action: paid | rejected, note? }(驳回必须写 note) */
        reviewWithdrawal: (operatorId, id, body) => run(() => {
            const b = asBody(body);
            return fx.reviewWithdrawal({ id: idOf(id), operatorId, action: reqOneOf(b, "action", ["paid", "rejected"]), ...optional("note", str(b, "note")) });
        }),
        applications: (query) => run(async () => {
            const q = asBody(query);
            const r = await fx.listApplications({ ...pageOf(q), ...optional("status", oneOf(q, "status", A_STATUSES)) });
            return withNames(r, r.items.map((a) => a.userId));
        }),
        /** { action: approve | reject, note? } */
        reviewApplication: (operatorId, id, body) => run(() => {
            const b = asBody(body);
            return fx.reviewApplication({ id: idOf(id), operatorId, action: reqOneOf(b, "action", ["approve", "reject"]), ...optional("note", str(b, "note")) });
        }),
        audit: (query) => run(async () => {
            const q = asBody(query);
            const r = await fx.listAudit({ ...pageOf(q), ...optional("targetUserId", str(q, "targetUserId", 64)), ...optional("action", str(q, "action", 40)) });
            return withNames(r, r.items.flatMap((a) => [a.actorId, ...(a.targetUserId ? [a.targetUserId] : [])]));
        }),
    };
}
