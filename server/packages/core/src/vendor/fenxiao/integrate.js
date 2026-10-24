/** 文案里的 {amount} {level} {reason} {net} 会被替换 */
export const DEFAULT_TEXTS = {
    memberBound: { title: "新成员加入你的团队", body: "有人通过你的邀请注册了。" },
    commissionCreated: { title: "获得一笔佣金", body: "{level}级下级付款,佣金 {amount},冻结期过后可提现。" },
    commissionHeld: { title: "一笔佣金待审核", body: "佣金 {amount} 正在审核,通过后到账。" },
    commissionReleased: { title: "佣金已到账", body: "{amount} 已转为可提现。" },
    commissionReversed: { title: "佣金已扣回", body: "下级订单退款,佣金 {amount} 已扣回。" },
    commissionApproved: { title: "佣金审核通过", body: "佣金 {amount} 已通过审核。" },
    commissionVoided: { title: "佣金未通过审核", body: "佣金 {amount} 已作废:{reason}" },
    commissionAdjusted: { title: "佣金调整", body: "运营调整 {amount}:{reason}" },
    withdrawalPaid: { title: "提现已打款", body: "提现 {amount} 已打款,实到 {net}。" },
    withdrawalRejected: { title: "提现被驳回", body: "提现 {amount} 被驳回,已退回可提现余额:{reason}" },
    applicationApproved: { title: "推广资格已开通", body: "现在可以分享你的邀请链接赚佣金了。" },
    applicationRejected: { title: "推广申请未通过", body: "{reason}" },
};
/** 分 → ¥12.34(负数带 -) */
export const formatCny = (cents) => {
    const neg = cents < 0n;
    const v = neg ? -cents : cents;
    return `${neg ? "-" : ""}¥${v / 100n}.${String(v % 100n).padStart(2, "0")}`;
};
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
function notice(o, userId, text, idemKey, vars, kind = "reward") {
    return { userId, kind, title: fill(text.title, vars), body: fill(text.body, vars), idemKey: idemKey.slice(0, 128), url: o.url };
}
function commissionNotices(ev, o) {
    const t = o.texts;
    const $ = o.formatAmount;
    switch (ev.type) {
        case "commission.created":
            return ev.commissions.map((c) => notice(o, c.beneficiaryUserId, c.status === "held" ? t.commissionHeld : t.commissionCreated, `fx:c:${c.id}`, { amount: $(c.amount), level: String(c.level) }));
        case "commission.released":
            return ev.items.map((i) => notice(o, i.userId, t.commissionReleased, `fx:r:${i.userId}:${Date.now()}`, { amount: $(i.amount) }));
        case "commission.reversed":
            return ev.items.map((i) => notice(o, i.userId, t.commissionReversed, `fx:x:${ev.sourceKind}:${ev.sourceRef}:${i.userId}`, { amount: $(i.amount), reason: ev.reason }));
        case "commission.reviewed": {
            const c = ev.commission;
            const text = ev.action === "approve" ? t.commissionApproved : t.commissionVoided;
            return [notice(o, c.beneficiaryUserId, text, `fx:h:${c.id}:${ev.action}`, { amount: $(c.amount), reason: c.reverseReason ?? "" })];
        }
        case "commission.adjusted":
            return [notice(o, ev.commission.beneficiaryUserId, t.commissionAdjusted, `fx:j:${ev.commission.id}`, { amount: $(ev.commission.amount), reason: ev.commission.note ?? "" })];
        default:
            return [];
    }
}
/** 事件 → 要发的站内通知 */
export function noticesFor(ev, o) {
    const t = o.texts;
    const $ = o.formatAmount;
    switch (ev.type) {
        case "member.bound":
            return ev.member.parentUserId ? [notice(o, ev.member.parentUserId, t.memberBound, `fx:b:${ev.member.userId}`, {}, "system")] : [];
        case "withdrawal.reviewed": {
            const w = ev.withdrawal;
            const text = w.status === "paid" ? t.withdrawalPaid : t.withdrawalRejected;
            return [notice(o, w.userId, text, `fx:w:${w.id}:${w.status}`, { amount: $(w.amount), net: $(w.net), reason: w.adminNote ?? "" })];
        }
        case "application.reviewed": {
            const a = ev.application;
            const text = a.status === "approved" ? t.applicationApproved : t.applicationRejected;
            return [notice(o, a.userId, text, `fx:a:${a.id}:${a.status}`, { reason: a.adminNote ?? "" }, "system")];
        }
        default:
            return commissionNotices(ev, o);
    }
}
const usersOf = (ev) => {
    switch (ev.type) {
        case "member.bound":
            return [ev.member.userId, ...ev.member.ancestors];
        case "member.updated":
            return [ev.member.userId, ...ev.member.ancestors];
        case "application.created":
        case "application.reviewed":
            return [ev.application.userId];
        case "commission.created":
            return ev.commissions.map((c) => c.beneficiaryUserId);
        case "commission.released":
        case "commission.reversed":
            return ev.items.map((i) => i.userId);
        case "commission.reviewed":
        case "commission.adjusted":
            return [ev.commission.beneficiaryUserId];
        default:
            return [ev.withdrawal.userId];
    }
};
/**
 * 事件 → 实时变更。前端订阅:
 *   推广人自己的页面 watch({ module: "fenxiao", type: "user", id: <userId> })
 *   后台分销页     watch({ module: "fenxiao", type: "admin", id: "all" })
 */
export function changesFor(ev, tenantId) {
    const event = `fenxiao.${ev.type}`;
    const users = [...new Set(usersOf(ev))];
    return [
        ...users.map((id) => ({ tenantId, event, ref: { module: "fenxiao", type: "user", id } })),
        { tenantId, event, ref: { module: "fenxiao", type: "admin", id: "all" }, rows: users.slice(0, 200) },
    ];
}
