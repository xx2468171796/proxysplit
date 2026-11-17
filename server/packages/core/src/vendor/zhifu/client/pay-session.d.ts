/**
 * 支付会话：二维码弹窗的「逻辑 + 文案」，与界面无关（React / Vue / Laya / Cocos / 原生 DOM 都能用）。
 *
 * 各站只负责「画」（用自己的风格和颜色），下面这些全站统一，别在站里再写一份：
 *   - 文案 `PAY_COPY`（业主 2026-10-31 定稿）
 *   - 倒计时 `payCountdown(expireAt)`：按**网关给的真实过期时间**倒数，不写死分钟数（章鱼哥 2 分钟、收钱吧 15 分钟）
 *   - 跳转按钮 `payJump(...)`：手机 = 直接打开 payUrl（通道自己的付款页，不拼 alipays:// 深链）；微信里 = 只给引导；电脑 = 收银台
 *   - 实时查单 `watchPayment(...)`：付完回调 onPaid（站点据此关二维码、提示「充值成功」），过期回调 onExpired；
 *     页面切到后台时暂停查单，回到前台立刻补查一次（省电，见 shengdian）
 */
import { type PayRules } from "../order/cooldown.ts";
export { PAY_COPY } from "./pay-copy.ts";
export * from "./pay-link.ts";
export * from "./pay-confirm.ts";
/** 4.6：服务端给的未付状态（`SiteOrder.unpaid`） */
export interface UnpaidStatusView {
    today: number;
    streak: number;
    nextWaitSec: number;
    leftBeforeBan: number;
}
/** 4.6：二维码弹窗常驻提示。ttlSec = 二维码剩余 / 有效秒数（按 expireAt 算） */
export declare function unpaidNoticeText(u: UnpaidStatusView | null | undefined, ttlSec: number): string | null;
/** 4.6：「你有一笔未支付的订单」弹窗文案。siteName 为空 = 本站 */
export declare function openOrderPrompt(open: {
    amountCents: number;
    sameSite: boolean;
    siteName?: string | null;
}): {
    title: "你有一笔未支付的订单";
    body: string;
    continueLabel: "继续支付";
    cancelLabel: "取消后重新下单";
    /** 别的站的单只能在那个站继续付；这里只能取消后重下 */
    canContinue: boolean;
};
/** 4.6：从支付宝回来仍未付的提醒 */
export declare function returnedUnpaidPrompt(amountCents: number): {
    title: "订单还未支付";
    body: string;
    continueLabel: "继续支付";
    laterLabel: "稍后再说";
};
/**
 * 4.6：页面从后台回到前台（玩家从支付宝切回来）时，订单还没付就调 onUnpaid 一次（站点弹「继续支付」）。
 * 只在玩家确实离开过页面（点了跳转支付宝）后触发；返回取消函数。
 */
export declare function watchReturnFromPay(opts: {
    isPending: () => Promise<boolean>;
    onUnpaid: () => void;
    /** 离开不足多久不算（毫秒），默认 3000 */
    minAwayMs?: number;
}): () => void;
export interface PayRulesDialog {
    title: string;
    /** 完整版：每行一段 */
    lines: string[];
    /** 短版（一段话，弹窗放不下多行时用） */
    short: string;
    confirm: string;
    /** 4.2：手机窄屏用的确认按钮短文案（「知晓并支付」） */
    confirmShort: string;
    cancel: string;
}
/**
 * 4.1：点支付时先弹的规则弹窗文案（站点用自己的弹窗组件显示，玩家点 confirm 才去下单）。
 * rules = 站点从后端拿的当前规则（OrderService.currentPayRules()），不给用默认 —— 文案永远跟设置同步。
 */
export declare function payRulesDialog(rules?: PayRules): PayRulesDialog;
/** 规则弹窗确认按钮：宽度 ≤ 430（手机）用短文案，避免「我已知晓，继续支付」折成两行 */
export declare function rulesConfirmLabel(width?: number | null): string;
export interface QueueNoticeOptions {
    /** 显示 / 更新排队弹窗（6.3：站点用自己的原生弹窗画 view —— 标题、前面 N 人、预计秒数、耐心提示、取消确认） */
    show: (text: string, view: QueueView) => void;
    /** 下单请求结束（成功失败都调） */
    hide: () => void;
    /** 请求超过多久还没回来才显示（毫秒），默认 400：不排队的单不闪一下 */
    delayMs?: number;
    /** 可选：查排队人数 / 预计毫秒（站点转发 OrderService.orderQueueStatus 或中心 queue 状态），每秒一次 */
    position?: () => Promise<{
        ahead: number;
        etaMs?: number;
        waitMs?: number;
    }>;
    pollMs?: number;
    /** 拿不到预计时间时每人按多少毫秒估（默认 5000 = 全站排队每 5 秒一单） */
    perHeadMs?: number;
    doc?: Pick<Document, "visibilityState"> | null;
}
/** 排队弹窗的统一内容（6.3）：站点只负责用自己的原生弹窗画出来 */
export interface QueueView {
    title: string;
    /** 前面还有几人（含 0） */
    ahead: number;
    /** 预计剩余毫秒（本地每秒倒数，每次查询重新对时） */
    etaMs: number;
    /** 一整句：排队中，前面还有 N 人，预计 X 秒。请耐心等待，离开或取消需重新排队。 */
    text: string;
    cancelLabel: string;
    cancelConfirm: string;
}
export declare function queueView(ahead: number, etaMs: number): QueueView;
/** 排队文案（6.3：始终带人数和预计秒数） */
export declare function queueNoticeText(ahead?: number | null, etaMs?: number | null, perHeadMs?: number): string;
/**
 * 包住「创建订单」请求 —— 超过 delayMs 没回来就显示排队弹窗（6.3：第二个参数是统一的 QueueView，站点用原生弹窗画），
 * 每秒本地倒数（只在页面可见时），给了 position 就每秒对一次人数 / 预计时间；请求一结束立刻 hide。返回原请求的结果。
 */
export declare function withQueueNotice<T>(request: Promise<T>, o: QueueNoticeOptions): Promise<T>;
/** 毫秒 → mm:ss（向上取整到秒，负数当 0） */
export declare function formatMmss(ms: number): string;
export interface PayCountdown {
    /** 剩余毫秒；拿不到过期时间 = null */
    leftMs: number | null;
    expired: boolean;
    /** 直接显示的一行字 */
    text: string;
}
/** 按网关的过期时间算倒计时；expireAt 缺失或解析不了时不倒数，只给「付款后自动到账」 */
export declare function payCountdown(expireAt: string | number | Date | null | undefined, now?: number): PayCountdown;
export type WatchedStatus = "pending" | "paid" | "expired" | "cancelled";
export interface WatchPaymentOptions {
    /** 查一次单：站点自己的查单接口，返回四种状态之一（站点把自己的状态名映射过来） */
    query: () => Promise<WatchedStatus>;
    /** 网关过期时间：到点后再宽限 graceMs 继续查（迟到的付款），之后停 */
    expireAt?: string | number | Date | null;
    intervalMs?: number;
    graceMs?: number;
    onPaid: () => void;
    onExpired?: () => void;
    /** 每秒一次（倒计时刷新用）；页面在后台时不调 */
    onTick?: (c: PayCountdown) => void;
    /** 测试注入 */
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (h: unknown) => void;
    /** 页面是否可见；默认读 document.visibilityState，没有 document 当可见 */
    visible?: () => boolean;
    /** 可见性变化订阅；默认挂 document 的 visibilitychange。返回取消函数 */
    onVisibilityChange?: (fn: () => void) => () => void;
}
/**
 * 实时查单 + 倒计时。返回 stop()（关弹窗时调用；付完 / 过期后会自己停）。
 * 查单出错只当「还没付」继续查，不打断玩家；一次查单没回来之前不发下一次。
 */
export declare function watchPayment(o: WatchPaymentOptions): {
    stop: () => void;
};
/** 4.8 排队页：服务端 ui.queue + 站点的 queuePoll 路由 */
export interface QueuePollResult {
    ready: boolean;
    position: number;
    etaMs: number;
    text?: string;
}
export interface WatchQueueOptions {
    /** 下单回来的 ui.queue（起点） */
    start: {
        position: number;
        eta_ms: number;
    };
    /** 调站点自己的「排队查询」路由（SitePay.queuePoll） */
    poll: () => Promise<QueuePollResult>;
    /** 每秒一次：要显示的那句话（倒数本地走，位置以服务端为准） */
    onText: (text: string, state: {
        position: number;
        etaMs: number;
        view: QueueView;
    }) => void;
    /** 轮到了：立刻用同样金额再下单（20 秒内直接放行） */
    onReady: () => void;
    /** 查询失败（网络）时：继续排，不打断；可选记日志 */
    onError?: (err: unknown) => void;
    everyMs?: number;
    hiddenEveryMs?: number;
    doc?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> | null;
}
/**
 * 排队中的弹窗驱动（站点只负责把 text 放进自己的弹窗）：每秒本地倒数，同时问一次服务端（同一时刻最多一个请求）；
 * 切到后台也每 5 秒问一次，保住位置（15 秒没心跳才出队）。返回 stop()：玩家点「取消排队」/ 关弹窗时调用。
 */
export declare function watchQueue(o: WatchQueueOptions): {
    stop: () => void;
};