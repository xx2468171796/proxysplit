import type { WatchedStatus } from "./pay-session.ts";
export declare const CONFIRM_POLL: {
    readonly fastMs: 1500;
    readonly fastForMs: 60000;
    readonly slowMs: 5000;
    readonly maxMs: number;
    readonly checkGapMs: 5000;
};
/** 确认中第 elapsedMs 毫秒时，下一次查单的间隔；null = 该停了 */
export declare function confirmPollDelay(elapsedMs: number, p?: Partial<typeof CONFIRM_POLL>): number | null;
export interface ConfirmingView {
    state: "confirming";
    /** 主文案（中心可改） */
    text: string;
    /** 已等待秒数（转圈旁的计时） */
    seconds: number;
    /** 「已等待 N 秒」 */
    secondsText: string;
}
/** copy = pay-config 的 copy.confirming（站点 / 浮层拿到什么传什么，空 = 默认） */
export declare function confirmingView(startedAt: number, now?: number, copy?: string | null): ConfirmingView;
type Doc = {
    visibilityState?: string;
    addEventListener?: (t: string, f: () => void) => void;
    removeEventListener?: (t: string, f: () => void) => void;
};
type Win = {
    addEventListener?: (t: string, f: () => void) => void;
    removeEventListener?: (t: string, f: () => void) => void;
};
/**
 * 玩家回到页面（从支付宝切回来）：visibilitychange 变可见、pageshow（含 bfcache 恢复）、focus 都算，
 * 同一次回来只回调一次（minGapMs 内去重）。只在之前离开过页面（hidden / blur / pagehide）后才回调。返回取消函数。
 */
export declare function onReturnFromPay(fn: () => void, o?: {
    doc?: Doc | null;
    win?: Win | null;
    now?: () => number;
    minGapMs?: number;
}): () => void;
export interface WatchConfirmingOptions {
    /** 查站点自己的订单状态（到账以站点为准） */
    query: () => Promise<WatchedStatus>;
    /** 可选：让中心立刻问上游（站点转发 `/v1/orders/check`）；失败忽略 */
    check?: () => Promise<unknown>;
    /** 每秒一次（仅可见时）：刷新文案 + 计时 */
    onTick: (v: ConfirmingView) => void;
    onPaid: () => void;
    /** 过期 / 取消（二维码失效且没付） */
    onClosed?: () => void;
    /** 确认了 maxMs 还没到账：浮层可改成「到账后会自动通知」并允许关闭 */
    onGiveUp?: () => void;
    /** pay-config copy.confirming */
    copy?: string | null;
    poll?: Partial<typeof CONFIRM_POLL>;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (h: unknown) => void;
    doc?: Doc | null;
    win?: Win | null;
}
/** 进入「支付确认中」：返回 stop() 与 recheck()（玩家再点「我已支付」时调用：立刻查 + 触发上游补查） */
export declare function watchConfirming(o: WatchConfirmingOptions): {
    stop: () => void;
    recheck: () => void;
};
export {};