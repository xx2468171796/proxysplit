/**
 * tuiguang/fenxiao —— 多级分销 / 经销商返佣(现金佣金账户 + 提现)。接入手册见 INTEGRATION.md「多级分销」一节。
 *
 *   const fx = createFenxiao({ db: pool, getPolicy });
 *   注册事务里:   await fx.bind({ userId, code, tx })
 *   付款履约事务里: await fx.settle({ buyerUserId, sourceRef: orderId, baseAmount: paidCents, tx })
 *   退款事务里:   await fx.reverse({ sourceRef: orderId, reason, tx })
 *   定时:         await fx.releaseDue()
 */
import { assertFxPolicy } from "./compute.js";
import * as ledger from "./ledger.js";
import * as members from "./members.js";
import * as queries from "./queries.js";
import { resolveTables } from "./sql.js";
export * from "./types.js";
export { assertFxPolicy, computeShares, ratesFor, findTier, chainUnder, DEFAULT_FX_POLICY, BPS, MAX_CHAIN, MAX_LEVELS } from "./compute.js";
export { DEFAULT_TABLES } from "./sql.js";
export { normalizeCode } from "./members.js";
export function createFenxiao(opts) {
    const t = resolveTables(opts.tables);
    const warn = opts.onWarn ?? (() => undefined);
    const fire = async (ev) => {
        try {
            await opts.onEvent?.(ev);
        }
        catch (e) {
            warn(`fenxiao onEvent(${ev.type}) 抛错`, e);
        }
    };
    const d = {
        db: opts.db,
        t,
        now: opts.now ?? (() => new Date()),
        policy: async (q) => {
            const p = await opts.getPolicy(q ?? opts.db);
            assertFxPolicy(p);
            return p;
        },
        emit: (ev, afterCommit) => {
            if (!opts.onEvent)
                return;
            if (afterCommit)
                afterCommit(() => fire(ev));
            else
                void fire(ev);
        },
    };
    return {
        tables: t,
        getPolicy: () => d.policy(),
        bind: (input) => members.bind(d, input),
        ensureCode: (userId, tx) => members.ensureCode(d, userId, tx),
        getMember: (userId) => members.getMember(d, userId),
        findByCode: (code) => members.findByCode(d, code),
        setMember: (input) => members.setMember(d, input),
        moveMember: (input) => members.moveMember(d, input),
        settle: (input) => ledger.settle(d, input),
        reverse: (input) => ledger.reverse(d, input),
        releaseDue: (o) => ledger.releaseDue(d, o),
        account: (userId) => ledger.account(d, userId),
        requestWithdrawal: (input) => ledger.requestWithdrawal(d, input),
        reviewWithdrawal: (input) => ledger.reviewWithdrawal(d, input),
        listMembers: (q) => queries.listMembers(d, q),
        listDownline: (q) => queries.listDownline(d, q),
        listCommissions: (q) => queries.listCommissions(d, q),
        listWithdrawals: (q) => queries.listWithdrawals(d, q),
        teamStats: (userId) => queries.teamStats(d, userId),
        overview: (since) => queries.overview(d, since),
    };
}
