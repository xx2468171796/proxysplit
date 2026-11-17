/**
 * 「支付确认中」状态（业主 2026-11-05）：玩家从支付宝回来 / 点「我已支付」后，到账前的那几秒。
 * 与界面无关：统一付款浮层（或任何站点界面）只负责把 view.text / view.seconds 画出来。
 *
 * - 文案：中心可改（pay-config `copy.confirming`），没有就用 PAY_COPY.confirming；明说「关闭页面也会自动到账」——
 *   到账靠中心回调 + 站点通知，与页面无关。
 * - 查单节奏：确认中前 60 秒每 1.5 秒查一次站点，之后退到 5 秒，10 分钟后停（shengdian：页面不可见时不查，
 *   回到前台立刻补查）。
 * - 上游提速：开始确认时、以及每次回到前台（间隔 ≥ 5 秒）调一次 `check`（站点转发中心 `/v1/orders/check`，
 *   中心立即问上游并在 +2/+4/+7/+12 秒补查），不必干等上游回调。
 */
import { PAY_COPY } from "./pay-copy.js";
export const CONFIRM_POLL = { fastMs: 1500, fastForMs: 60000, slowMs: 5000, maxMs: 10 * 60000, checkGapMs: 5000 };
/** 确认中第 elapsedMs 毫秒时，下一次查单的间隔；null = 该停了 */
export function confirmPollDelay(elapsedMs, p = {}) {
    const c = { ...CONFIRM_POLL, ...p };
    if (elapsedMs >= c.maxMs)
        return null;
    return elapsedMs < c.fastForMs ? c.fastMs : c.slowMs;
}
/** copy = pay-config 的 copy.confirming（站点 / 浮层拿到什么传什么，空 = 默认） */
export function confirmingView(startedAt, now = Date.now(), copy) {
    const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    return {
        state: "confirming",
        text: copy?.trim() ? copy.trim() : PAY_COPY.confirming,
        seconds,
        secondsText: PAY_COPY.confirmingSeconds.replace("{n}", String(seconds)),
    };
}
/**
 * 玩家回到页面（从支付宝切回来）：visibilitychange 变可见、pageshow（含 bfcache 恢复）、focus 都算，
 * 同一次回来只回调一次（minGapMs 内去重）。只在之前离开过页面（hidden / blur / pagehide）后才回调。返回取消函数。
 */
export function onReturnFromPay(fn, o = {}) {
    const g = globalThis;
    const doc = o.doc === undefined ? (g.document ?? null) : o.doc;
    const win = o.win === undefined ? (g.window ?? null) : o.win;
    const now = o.now ?? (() => Date.now());
    const gap = o.minGapMs ?? 1000;
    let away = false;
    let last = Number.NEGATIVE_INFINITY;
    const leave = () => {
        away = true;
    };
    const back = () => {
        if (doc?.visibilityState === "hidden")
            return leave();
        if (!away || now() - last < gap)
            return;
        away = false;
        last = now();
        fn();
    };
    const pairs = [
        [doc, "visibilitychange", back],
        [win, "pageshow", back],
        [win, "focus", back],
        [win, "pagehide", leave],
        [win, "blur", leave],
    ];
    for (const [t, ev, f] of pairs)
        t?.addEventListener?.(ev, f);
    return () => {
        for (const [t, ev, f] of pairs)
            t?.removeEventListener?.(ev, f);
    };
}
/** 进入「支付确认中」：返回 stop() 与 recheck()（玩家再点「我已支付」时调用：立刻查 + 触发上游补查） */
export function watchConfirming(o) {
    const now = o.now ?? (() => Date.now());
    const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h));
    const g = globalThis;
    const doc = o.doc === undefined ? (g.document ?? null) : o.doc;
    const visible = () => doc?.visibilityState !== "hidden";
    const c = { ...CONFIRM_POLL, ...o.poll };
    const started = now();
    let stopped = false;
    let inFlight = false;
    let lastQuery = Number.NEGATIVE_INFINITY;
    let lastCheck = Number.NEGATIVE_INFINITY;
    let handle = null;
    const askUpstream = () => {
        if (!o.check || now() - lastCheck < c.checkGapMs)
            return;
        lastCheck = now();
        void o.check().catch(() => undefined);
    };
    const finish = () => {
        stopped = true;
        if (handle !== null)
            clearTimer(handle);
        handle = null;
        unsubscribe();
    };
    const query = async () => {
        if (stopped || inFlight)
            return;
        inFlight = true;
        lastQuery = now();
        const s = await o.query().catch(() => "pending");
        inFlight = false;
        if (stopped)
            return;
        if (s === "paid") {
            finish();
            o.onPaid();
        }
        else if (s === "expired" || s === "cancelled") {
            finish();
            o.onClosed?.();
        }
    };
    const loop = () => {
        handle = null;
        if (stopped || !visible())
            return; // 不可见不查（shengdian），回到前台由 onReturnFromPay 接上
        const t = now();
        const delay = confirmPollDelay(t - started, c);
        if (delay === null) {
            finish();
            o.onGiveUp?.();
            return;
        }
        o.onTick(confirmingView(started, t, o.copy));
        if (t - lastQuery >= delay)
            void query();
        handle = setTimer(loop, 1000);
    };
    const recheck = () => {
        if (stopped)
            return;
        askUpstream();
        lastQuery = Number.NEGATIVE_INFINITY;
        if (handle !== null)
            clearTimer(handle);
        loop();
    };
    const unsubscribe = onReturnFromPay(recheck, { doc, win: o.win });
    askUpstream();
    loop();
    return { stop: finish, recheck };
}
