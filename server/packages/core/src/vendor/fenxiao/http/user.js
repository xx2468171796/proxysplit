/**
 * 推广人(用户本人)侧处理器。userId 由宿主鉴权给出,包不碰登录态。
 * 推广人看到的下级 / 买家名字一律打码(names 投影 + maskName)。
 */
import { canPromote, findTier } from "../policy.js";
import { amount, asBody, handle, int, namesOf, oneOf, pageOf, reqStr, str } from "./shared.js";
const COMMISSION_STATUSES = ["frozen", "available", "held", "reversed"];
const WITHDRAWAL_STATUSES = ["pending", "paid", "rejected"];
/** 推广人能看到的规则摘要(不含别人的比例) */
function publicPolicy(p, myRates) {
    return {
        enabled: p.enabled,
        mode: p.mode,
        maxLevels: p.maxLevels,
        myRates,
        freezeDays: p.freezeDays,
        application: p.application,
        minWithdrawal: p.minWithdrawal,
        withdrawalFeeBps: p.withdrawalFeeBps,
        withdrawalFeeFixed: p.withdrawalFeeFixed,
    };
}
async function inviterName(o, parentUserId) {
    if (!parentUserId)
        return null;
    const names = await namesOf(o.names, [parentUserId], true);
    return names[parentUserId] ?? null;
}
/** 推广中心首页:资格、邀请码 / 链接、余额、团队、待审申请 */
async function me(fx, o, userId) {
    const [policy, member, account, team, apps] = await Promise.all([
        fx.getPolicy(),
        fx.getMember(userId),
        fx.account(userId),
        fx.teamStats(userId),
        fx.listApplications({ userId, status: "pending", limit: 1 }),
    ]);
    const eligible = canPromote(policy, member);
    const tier = findTier(policy, member?.tierCode ?? null);
    const rates = member?.rateOverride ?? tier?.rates ?? (policy.openToAll ? policy.defaultRates : null);
    const code = eligible ? (member?.code ?? null) : null;
    return {
        eligible,
        tierName: tier?.name ?? null,
        code,
        link: code && o.inviteLink ? o.inviteLink(code) : null,
        inviter: await inviterName(o, member?.parentUserId ?? null),
        account,
        team,
        pendingApplication: apps.items[0] ?? null,
        policy: publicPolicy(policy, eligible ? rates : null),
    };
}
export function createUserHandlers(fx, o = {}) {
    const run = (fn) => handle(o.logger, fn);
    return {
        me: (userId) => run(() => me(fx, o, userId)),
        /** 领邀请码(有资格才行) */
        ensureCode: (userId) => run(async () => {
            const m = await fx.ensureCode(userId);
            return { code: m.code, link: m.code && o.inviteLink ? o.inviteLink(m.code) : null };
        }),
        /** 我的团队:level 不传 = 全部层级 */
        team: (userId, query) => run(async () => {
            const q = asBody(query);
            const level = int(q, "level");
            const r = await fx.listDownline({ userId, ...(level === undefined ? {} : { level }), ...pageOf(q) });
            const names = await namesOf(o.names, r.items.map((m) => m.userId), true);
            return { ...r, items: r.items.map((m) => ({ name: names[m.userId] ?? "用户", depth: m.depth, boundAt: m.boundAt })) };
        }),
        /** 我的佣金明细(买家打码) */
        commissions: (userId, query) => run(async () => {
            const q = asBody(query);
            const status = oneOf(q, "status", COMMISSION_STATUSES);
            const r = await fx.listCommissions({ beneficiaryUserId: userId, ...(status ? { status } : {}), ...pageOf(q) });
            const names = await namesOf(o.names, r.items.map((c) => c.buyerUserId), true);
            return {
                ...r,
                items: r.items.map((c) => ({
                    id: c.id,
                    kind: c.sourceKind,
                    buyer: c.sourceKind === "adjust" ? null : (names[c.buyerUserId] ?? "用户"),
                    level: c.level,
                    baseAmount: c.baseAmount,
                    rateBps: c.rateBps,
                    amount: c.amount,
                    status: c.status,
                    availableAt: c.availableAt,
                    // 挂起原因是风控内部信号,不给推广人看
                    reason: c.status === "held" ? "审核中" : (c.reverseReason ?? c.note),
                    createdAt: c.createdAt,
                })),
            };
        }),
        withdrawals: (userId, query) => run(async () => {
            const q = asBody(query);
            const status = oneOf(q, "status", WITHDRAWAL_STATUSES);
            return fx.listWithdrawals({ userId, ...(status ? { status } : {}), ...pageOf(q) });
        }),
        /** 申请提现:{ amount, payee: { method, account, name } } */
        withdraw: (userId, body) => run(async () => {
            const b = asBody(body);
            const p = asBody(b.payee);
            return fx.requestWithdrawal({ userId, amount: amount(b, "amount"), payee: { method: reqStr(p, "method", 20), account: reqStr(p, "account", 100), name: reqStr(p, "name", 50) } });
        }),
        /** 申请成为推广员:{ message? } */
        apply: (userId, body) => run(async () => {
            const message = str(asBody(body), "message", 500);
            return fx.apply({ userId, ...(message ? { message } : {}) });
        }),
    };
}
