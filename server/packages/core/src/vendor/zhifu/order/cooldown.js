/**
 * 下单冷却 / 未付阶梯 / 封禁（4.1 新阶梯，业主 2026-11-01，取代 3.24 的「3 笔免罚」）—— 纯函数，规则只有这一份：
 *
 * - 同一用户两次下单至少隔 `baseIntervalSec`（默认 30 秒）。
 * - 从第 1 笔未付算起（自上一笔已付以来的单子，不论过期 / 取消 / 还挂着），下一单要等：
 *   第 1 笔 1 分钟 → 第 2 笔 3 分钟 → 第 3 笔 15 分钟 → 第 4 笔 2 小时 → 第 5 笔 12 小时 → 第 6、7 笔 24 小时；
 *   **第 8 笔未付 → 取消支付权限**（全站按手机号，后台解封，解封清零）。
 * - 付成功一笔就清零；等待从最近一笔的下单时间算起。
 * - 全部参数（开关 / 基础间隔 / 阶梯 / 封禁笔数）在共享设置 `zhifu_gate:settings` 的 `rules` 里，后台改了现读生效。
 */
export const DEFAULT_PAY_RULES = {
    enabled: true,
    baseIntervalSec: 30,
    ladderSec: [60, 180, 900, 7200, 43200, 86400, 86400],
    banAfterUnpaid: 8,
};
/** 兼容 3.24 的导出名（值已换成 4.1 新阶梯） */
export const UNPAID_LADDER_SEC = DEFAULT_PAY_RULES.ladderSec;
export const UNPAID_FREE_STREAK = 0;
export const BASE_ORDER_INTERVAL_SEC = 30;
/** 算连续未付要往回看几笔 */
export const COOLDOWN_LOOKBACK = 12;
export const PAY_BANNED_MESSAGE = "您的支付权限已被取消，如有疑问请联系客服";
function intList(v) {
    if (!Array.isArray(v) || !v.length || v.length > 30)
        return null;
    const out = v.map((x) => Math.round(Number(x)));
    return out.every((x) => Number.isFinite(x) && x >= 0 && x <= 30 * 86400) ? out : null;
}
/** 解析后台存的规则；坏字段回默认 */
export function normalizePayRules(raw, base = DEFAULT_PAY_RULES) {
    const o = raw && typeof raw === "object" ? raw : {};
    const num = (v, min, max, d) => {
        const n = Number(v);
        return v === undefined || v === null || !Number.isFinite(n) ? d : Math.min(max, Math.max(min, Math.round(n)));
    };
    return {
        enabled: typeof o.enabled === "boolean" ? o.enabled : base.enabled,
        baseIntervalSec: num(o.baseIntervalSec, 0, 3600, base.baseIntervalSec),
        ladderSec: intList(o.ladderSec) ?? base.ladderSec,
        banAfterUnpaid: num(o.banAfterUnpaid, 0, 100, base.banAfterUnpaid),
    };
}
function rulesOf(r) {
    if (typeof r === "number")
        return { ...DEFAULT_PAY_RULES, baseIntervalSec: r };
    return r ?? DEFAULT_PAY_RULES;
}
/** 有 n 笔连续未付时，下一单离上一单至少要隔几秒（第二参可给基础秒数或整套规则） */
export function intervalForStreak(n, r) {
    const rules = rulesOf(r);
    if (n <= 0 || !rules.ladderSec.length)
        return rules.baseIntervalSec;
    const i = Math.min(n - 1, rules.ladderSec.length - 1);
    return Math.max(rules.baseIntervalSec, rules.ladderSec[i] ?? rules.baseIntervalSec);
}
/** 秒 → 「1 分钟」「2 小时」「1 天」「45 秒」，按最大整单位 */
export function formatWait(sec) {
    const s = Math.max(0, Math.ceil(sec));
    if (s >= 86400 && s % 86400 === 0)
        return `${s / 86400} 天`;
    if (s >= 3600)
        return s % 3600 === 0 ? `${s / 3600} 小时` : `${Math.floor(s / 3600)} 小时 ${Math.ceil((s % 3600) / 60)} 分钟`;
    if (s >= 60)
        return s % 60 === 0 ? `${s / 60} 分钟` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
    return `${s} 秒`;
}
/** 连续未付笔数：从最近一笔往前数，遇到 paid 停（recent 按下单时间倒序）；拆单同组只算一笔 */
export function unpaidStreakOf(recent) {
    let n = 0;
    const groups = new Set();
    for (const o of recent) {
        if (o.status === "paid" || o.status === "processing")
            break;
        if (o.groupId) {
            if (groups.has(o.groupId))
                continue;
            groups.add(o.groupId);
        }
        n++;
    }
    return n;
}
/** 按「连续未付笔数 + 最近下单时间」判：封禁 / 要等 / 放行（站内与全站共享状态共用） */
export function judgeUnpaid(unpaidStreak, lastAt, now = Date.now(), r) {
    const rules = rulesOf(r);
    if (!rules.enabled)
        return { waitSec: 0, unpaidStreak, message: null };
    if (rules.banAfterUnpaid > 0 && unpaidStreak >= rules.banAfterUnpaid) {
        return { waitSec: 0, unpaidStreak, message: PAY_BANNED_MESSAGE, banned: true };
    }
    if (!lastAt)
        return { waitSec: 0, unpaidStreak, message: null };
    const left = lastAt.getTime() + intervalForStreak(unpaidStreak, rules) * 1000 - now;
    const waitSec = left > 0 ? Math.ceil(left / 1000) : 0;
    if (!waitSec)
        return { waitSec, unpaidStreak, message: null };
    const message = unpaidStreak >= 1 && intervalForStreak(unpaidStreak, rules) > rules.baseIntervalSec
        ? `您已连续 ${unpaidStreak} 笔订单未支付，请 ${formatWait(waitSec)}后再下单`
        : `下单太频繁，请 ${waitSec} 秒后再试`;
    return { waitSec, unpaidStreak, message };
}
/** 现在能不能下单。recent = 该用户最近的单（倒序，至少取 COOLDOWN_LOOKBACK 笔） */
export function orderCooldown(recent, now = Date.now(), r) {
    return judgeUnpaid(unpaidStreakOf(recent), recent[0]?.createdAt ?? null, now, r);
}
/**
 * 刚下了一单（还没付）之后的提示：这单不付，下一单要等多久 / 再有几笔未付将取消支付权限。
 * `unpaidBefore` = 下这单之前的连续未付笔数。超过基础间隔才给，否则 null。
 */
export function nextOrderTip(unpaidBefore, r) {
    const rules = rulesOf(r);
    if (!rules.enabled)
        return null;
    const after = unpaidBefore + 1;
    if (rules.banAfterUnpaid > 0 && after >= rules.banAfterUnpaid) {
        return `温馨提示：您已连续 ${unpaidBefore} 笔订单未支付，本单如不支付，您的支付权限将被取消`;
    }
    const next = intervalForStreak(after, rules);
    if (next <= rules.baseIntervalSec)
        return null;
    const head = unpaidBefore > 0 ? `温馨提示：您已连续 ${unpaidBefore} 笔订单未支付，` : "温馨提示：";
    const left = rules.banAfterUnpaid > 0 ? rules.banAfterUnpaid - after : 0;
    const ban = left > 0 && left <= 3 ? `；再有 ${left} 笔未支付将取消支付权限` : "";
    return `${head}本单如不支付，下次充值需等待 ${formatWait(next)}${ban}`;
}
/** 付款规则弹窗的正文（点支付前先弹，站点用自己的弹窗组件；按当前规则现算，与设置同步） */
export function payRulesLines(r) {
    const rules = rulesOf(r);
    const lines = ["恶意刷单、创建订单不支付的，平台可能永久取消该手机号在全站的支付权限（平台可审核解封）。"];
    if (!rules.enabled)
        return lines;
    lines.push(`两次下单至少间隔 ${formatWait(rules.baseIntervalSec)}。`);
    const steps = rules.ladderSec.map((s, i) => `第 ${i + 1} 笔 ${formatWait(Math.max(s, rules.baseIntervalSec))}`);
    if (steps.length)
        lines.push(`连续未支付后再下单需等待：${steps.join("，")}。`);
    if (rules.banAfterUnpaid > 0)
        lines.push(`连续 ${rules.banAfterUnpaid} 笔未支付将取消支付权限。付款成功一笔即清零。`);
    return lines;
}
