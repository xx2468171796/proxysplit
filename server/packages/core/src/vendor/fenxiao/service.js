/**
 * createFenxiao —— 唯一入口。接入手册见 INTEGRATION.md。
 *
 *   const fx = createFenxiao({ db: pool, getPolicy, notify, publishChange, logger });
 *   注册事务里:   await fx.bind({ userId, code, tx, afterCommit })
 *   付款履约事务里: await fx.settle({ buyerUserId, sourceRef: orderId, baseAmount: paidCents, productKey, tx, afterCommit })
 *   退款事务里:   await fx.reverse({ sourceRef: orderId, reason, tx, afterCommit })
 *   定时:         await fx.releaseDue()
 */
import * as applications from "./applications.js";
import { changesFor, DEFAULT_TEXTS, formatCny, noticesFor } from "./integrate.js";
import * as ledger from "./ledger.js";
import * as members from "./members.js";
import { assertFxPolicy, withPolicyDefaults } from "./policy.js";
import * as queries from "./queries.js";
import * as review from "./review.js";
import { resolveTables } from "./sql.js";
import * as stats from "./stats.js";
import * as withdrawals from "./withdrawals.js";
function makeDispatch(opts) {
    const log = opts.logger;
    const noticeOpts = {
        texts: { ...DEFAULT_TEXTS, ...opts.notice?.texts },
        formatAmount: opts.notice?.formatAmount ?? formatCny,
        url: opts.notice?.url ?? null,
    };
    const tenantId = opts.tenantId ?? "default";
    const safe = async (what, fn) => {
        try {
            await fn();
        }
        catch (e) {
            log?.warn(`fenxiao ${what} 失败`, { err: e instanceof Error ? e.message : String(e) });
        }
    };
    return async (events) => {
        for (const ev of events) {
            if (opts.onEvent)
                await safe(`onEvent(${ev.type})`, () => opts.onEvent?.(ev));
            if (opts.notify)
                for (const n of noticesFor(ev, noticeOpts))
                    await safe(`notify(${ev.type})`, () => opts.notify?.(n));
            if (opts.publishChange)
                await safe(`publishChange(${ev.type})`, () => opts.publishChange?.(changesFor(ev, tenantId)));
        }
    };
}
export function createFenxiao(opts) {
    const d = {
        db: opts.db,
        t: resolveTables(opts.tables),
        now: opts.now ?? (() => new Date()),
        policy: async (q) => {
            const p = withPolicyDefaults(await opts.getPolicy(q ?? opts.db));
            assertFxPolicy(p);
            return p;
        },
        dispatch: makeDispatch(opts),
        risk: opts.riskCheck,
    };
    return {
        tables: d.t,
        getPolicy: () => d.policy(),
        // 关系
        bind: (input) => members.bind(d, input),
        ensureCode: (userId, tx) => members.ensureCode(d, userId, tx),
        getMember: (userId) => members.memberOf(d.db, d, userId),
        findByCode: (code) => members.findByCode(d, code),
        setMember: (input) => members.setMember(d, input),
        moveMember: (input) => members.moveMember(d, input),
        apply: (input) => applications.apply(d, input),
        reviewApplication: (input) => applications.reviewApplication(d, input),
        // 记账
        settle: (input) => ledger.settle(d, input),
        reverse: (input) => ledger.reverse(d, input),
        releaseDue: (o) => ledger.releaseDue(d, o),
        account: (userId) => ledger.account(d, userId),
        reviewCommission: (input) => review.reviewCommission(d, input),
        adjust: (input) => review.adjust(d, input),
        requestWithdrawal: (input) => withdrawals.requestWithdrawal(d, input),
        reviewWithdrawal: (input) => withdrawals.reviewWithdrawal(d, input),
        // 查询
        listMembers: (q) => queries.listMembers(d, q),
        listDownline: (q) => queries.listDownline(d, q),
        listCommissions: (q) => queries.listCommissions(d, q),
        listWithdrawals: (q) => queries.listWithdrawals(d, q),
        listApplications: (q) => queries.listApplications(d, q),
        listAudit: (q) => queries.listAudit(d, q),
        teamStats: (userId) => stats.teamStats(d, userId),
        overview: (since) => stats.overview(d, since),
        leaderboard: (q) => stats.leaderboard(d, q),
    };
}
