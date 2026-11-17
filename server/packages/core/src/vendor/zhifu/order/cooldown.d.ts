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
export interface PayRules {
    enabled: boolean;
    /** 同一用户两次下单最短间隔（秒） */
    baseIntervalSec: number;
    /** 第 1、2、3… 笔连续未付之后要等的秒数；超出长度取最后一档 */
    ladderSec: number[];
    /** 连续未付到第几笔取消支付权限；0 = 不封 */
    banAfterUnpaid: number;
}
export declare const DEFAULT_PAY_RULES: PayRules;
/** 兼容 3.24 的导出名（值已换成 4.1 新阶梯） */
export declare const UNPAID_LADDER_SEC: number[];
export declare const UNPAID_FREE_STREAK = 0;
export declare const BASE_ORDER_INTERVAL_SEC = 30;
/** 算连续未付要往回看几笔 */
export declare const COOLDOWN_LOOKBACK = 12;
export declare const PAY_BANNED_MESSAGE = "\u60A8\u7684\u652F\u4ED8\u6743\u9650\u5DF2\u88AB\u53D6\u6D88\uFF0C\u5982\u6709\u7591\u95EE\u8BF7\u8054\u7CFB\u5BA2\u670D";
export interface RecentOrder {
    status: string;
    createdAt: Date;
    /** 拆单的组号：同组几笔只算一单 */
    groupId?: string | null;
}
export interface OrderCooldown {
    /** 还要等几秒才能下单；0 = 现在可以 */
    waitSec: number;
    /** 自上一笔已付以来连续没付的笔数 */
    unpaidStreak: number;
    /** 被拦时给玩家看的文案；waitSec = 0 且未封时为 null */
    message: string | null;
    /** 4.1：连续未付达到封禁笔数 */
    banned?: boolean;
}
/** 解析后台存的规则；坏字段回默认 */
export declare function normalizePayRules(raw: unknown, base?: PayRules): PayRules;
/** 有 n 笔连续未付时，下一单离上一单至少要隔几秒（第二参可给基础秒数或整套规则） */
export declare function intervalForStreak(n: number, r?: number | PayRules): number;
/** 秒 → 「1 分钟」「2 小时」「1 天」「45 秒」，按最大整单位 */
export declare function formatWait(sec: number): string;
/** 连续未付笔数：从最近一笔往前数，遇到 paid 停（recent 按下单时间倒序）；拆单同组只算一笔 */
export declare function unpaidStreakOf(recent: readonly RecentOrder[]): number;
/** 按「连续未付笔数 + 最近下单时间」判：封禁 / 要等 / 放行（站内与全站共享状态共用） */
export declare function judgeUnpaid(unpaidStreak: number, lastAt: Date | null, now?: number, r?: number | PayRules): OrderCooldown;
/** 现在能不能下单。recent = 该用户最近的单（倒序，至少取 COOLDOWN_LOOKBACK 笔） */
export declare function orderCooldown(recent: readonly RecentOrder[], now?: number, r?: number | PayRules): OrderCooldown;
/**
 * 刚下了一单（还没付）之后的提示：这单不付，下一单要等多久 / 再有几笔未付将取消支付权限。
 * `unpaidBefore` = 下这单之前的连续未付笔数。超过基础间隔才给，否则 null。
 */
export declare function nextOrderTip(unpaidBefore: number, r?: number | PayRules): string | null;
/** 付款规则弹窗的正文（点支付前先弹，站点用自己的弹窗组件；按当前规则现算，与设置同步） */
export declare function payRulesLines(r?: PayRules): string[];