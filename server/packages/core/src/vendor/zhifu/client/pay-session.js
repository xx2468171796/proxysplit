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
import { DEFAULT_PAY_RULES, formatWait, payRulesLines } from "../order/cooldown.js";
import { PAY_CANCEL_CONFIRM, queueLine } from "../center/ui.js";
export { PAY_COPY } from "./pay-copy.js";
import { PAY_COPY } from "./pay-copy.js";
export * from "./pay-link.js";
export * from "./pay-confirm.js";
/** 4.6：二维码弹窗常驻提示。ttlSec = 二维码剩余 / 有效秒数（按 expireAt 算） */
export function unpaidNoticeText(u, ttlSec) {
    if (!u || u.nextWaitSec <= 0)
        return null;
    const ttl = formatWait(Math.max(60, Math.round(ttlSec / 60) * 60));
    const head = PAY_COPY.unpaidNotice
        .replace("{ttl}", ttl)
        .replace("{today}", String(u.today))
        .replace("{wait}", formatWait(u.nextWaitSec));
    const ban = u.leftBeforeBan > 0 && u.leftBeforeBan <= 3 ? PAY_COPY.unpaidNoticeBan.replace("{left}", String(u.leftBeforeBan)) : "";
    return ban ? `${head.slice(0, -1)}${ban}）` : head;
}
/** 4.6：「你有一笔未支付的订单」弹窗文案。siteName 为空 = 本站 */
export function openOrderPrompt(open) {
    const site = open.sameSite || !open.siteName ? "本站" : `「${open.siteName}」`;
    return {
        title: PAY_COPY.openOrderTitle,
        body: PAY_COPY.openOrderBody.replace("{site}", site).replace("{amount}", (open.amountCents / 100).toFixed(2)),
        continueLabel: PAY_COPY.openOrderContinue,
        cancelLabel: PAY_COPY.openOrderCancel,
        /** 别的站的单只能在那个站继续付；这里只能取消后重下 */
        canContinue: open.sameSite,
    };
}
/** 4.6：从支付宝回来仍未付的提醒 */
export function returnedUnpaidPrompt(amountCents) {
    return {
        title: PAY_COPY.returnedTitle,
        body: PAY_COPY.returnedBody.replace("{amount}", (amountCents / 100).toFixed(2)),
        continueLabel: PAY_COPY.returnedContinue,
        laterLabel: PAY_COPY.returnedLater,
    };
}
/**
 * 4.6：页面从后台回到前台（玩家从支付宝切回来）时，订单还没付就调 onUnpaid 一次（站点弹「继续支付」）。
 * 只在玩家确实离开过页面（点了跳转支付宝）后触发；返回取消函数。
 */
export function watchReturnFromPay(opts) {
    const doc = globalThis.document;
    if (!doc)
        return () => { };
    let hiddenAt = 0;
    const onVis = () => {
        if (doc.visibilityState === "hidden") {
            hiddenAt = Date.now();
            return;
        }
        if (!hiddenAt || Date.now() - hiddenAt < (opts.minAwayMs ?? 3000))
            return;
        hiddenAt = 0;
        void opts.isPending().then((p) => p && opts.onUnpaid(), () => { });
    };
    doc.addEventListener("visibilitychange", onVis);
    return () => doc.removeEventListener("visibilitychange", onVis);
}
/**
 * 4.1：点支付时先弹的规则弹窗文案（站点用自己的弹窗组件显示，玩家点 confirm 才去下单）。
 * rules = 站点从后端拿的当前规则（OrderService.currentPayRules()），不给用默认 —— 文案永远跟设置同步。
 */
export function payRulesDialog(rules = DEFAULT_PAY_RULES) {
    const steps = rules.ladderSec.slice(0, 3).map((s) => formatWait(Math.max(s, rules.baseIntervalSec))).join("/");
    const short = rules.enabled
        ? `恶意刷单、下单不支付的，平台可能永久取消该手机号全站支付权限（可审核解封）。两次下单间隔 ${formatWait(rules.baseIntervalSec)}；未支付后再下单需等待 ${steps}…，连续 ${rules.banAfterUnpaid} 笔未支付将取消支付权限。`
        : "恶意刷单、下单不支付的，平台可能永久取消该手机号全站支付权限（可审核解封）。";
    return { title: PAY_COPY.rulesTitle, lines: payRulesLines(rules), short, confirm: PAY_COPY.rulesConfirm, confirmShort: PAY_COPY.rulesConfirmShort, cancel: PAY_COPY.rulesCancel };
}
/** 规则弹窗确认按钮：宽度 ≤ 430（手机）用短文案，避免「我已知晓，继续支付」折成两行 */
export function rulesConfirmLabel(width) {
    const w = width ?? globalThis.innerWidth ?? 1024;
    return w <= 430 ? PAY_COPY.rulesConfirmShort : PAY_COPY.rulesConfirm;
}
export function queueView(ahead, etaMs) {
    return { title: "排队中", ahead: Math.max(0, ahead), etaMs: Math.max(0, etaMs), text: queueLine(ahead, etaMs), cancelLabel: "取消排队", cancelConfirm: PAY_CANCEL_CONFIRM };
}
/** 排队文案（6.3：始终带人数和预计秒数） */
export function queueNoticeText(ahead, etaMs, perHeadMs = 5000) {
    const n = Math.max(0, ahead ?? 0);
    return queueLine(n, etaMs ?? (n + 1) * perHeadMs);
}
/**
 * 包住「创建订单」请求 —— 超过 delayMs 没回来就显示排队弹窗（6.3：第二个参数是统一的 QueueView，站点用原生弹窗画），
 * 每秒本地倒数（只在页面可见时），给了 position 就每秒对一次人数 / 预计时间；请求一结束立刻 hide。返回原请求的结果。
 */
export async function withQueueNotice(request, o) {
    const perHead = o.perHeadMs ?? 5000;
    const doc = o.doc === undefined ? (typeof document === "undefined" ? null : document) : o.doc;
    let shown = false;
    let ahead = 0;
    let deadline = 0;
    let tick = null;
    let lastAsk = 0;
    const paint = () => {
        if (!shown)
            return;
        const v = queueView(ahead, deadline - Date.now());
        o.show(v.text, v);
    };
    const refresh = () => {
        lastAsk = Date.now();
        o.position?.().then((p) => {
            if (!shown)
                return;
            ahead = Math.max(0, p.ahead || 0);
            const eta = p.etaMs ?? p.waitMs;
            deadline = Date.now() + (eta !== undefined && eta > 0 ? eta : (ahead + 1) * perHead);
            paint();
        }, () => { });
    };
    const timer = setTimeout(() => {
        shown = true;
        deadline = Date.now() + perHead;
        paint();
        if (o.position)
            refresh();
        // shengdian-ok: 只在下单请求未返回期间跑（中心最多挂 2.5 秒），切后台不画不问，请求结束即清
        tick = setInterval(() => {
            if (doc?.visibilityState === "hidden")
                return;
            paint();
            if (o.position && Date.now() - lastAsk >= (o.pollMs ?? 1000))
                refresh();
        }, 1000);
    }, o.delayMs ?? 400);
    try {
        return await request;
    }
    finally {
        clearTimeout(timer);
        if (tick)
            clearInterval(tick);
        if (shown) {
            shown = false;
            o.hide();
        }
    }
}
/** 毫秒 → mm:ss（向上取整到秒，负数当 0） */
export function formatMmss(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm < 10 ? "0" : ""}${mm}:${ss < 10 ? "0" : ""}${ss}`;
}
/** 按网关的过期时间算倒计时；expireAt 缺失或解析不了时不倒数，只给「付款后自动到账」 */
export function payCountdown(expireAt, now = Date.now()) {
    const at = expireAt instanceof Date ? expireAt.getTime() : typeof expireAt === "number" ? expireAt : expireAt ? Date.parse(expireAt) : Number.NaN;
    if (!Number.isFinite(at))
        return { leftMs: null, expired: false, text: PAY_COPY.waiting };
    const leftMs = at - now;
    if (leftMs <= 0)
        return { leftMs: 0, expired: true, text: PAY_COPY.expired };
    return { leftMs, expired: false, text: PAY_COPY.countdown.replace("{time}", formatMmss(leftMs)) };
}
/**
 * 实时查单 + 倒计时。返回 stop()（关弹窗时调用；付完 / 过期后会自己停）。
 * 查单出错只当「还没付」继续查，不打断玩家；一次查单没回来之前不发下一次。
 */
export function watchPayment(o) {
    const now = o.now ?? (() => Date.now());
    const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h));
    const doc = globalThis.document;
    const visible = o.visible ?? (() => doc?.visibilityState !== "hidden");
    const subscribe = o.onVisibilityChange ?? ((fn) => {
        doc?.addEventListener?.("visibilitychange", fn);
        return () => doc?.removeEventListener?.("visibilitychange", fn);
    });
    const intervalMs = o.intervalMs ?? 2500;
    const graceMs = o.graceMs ?? 60000;
    const expireAt = o.expireAt == null ? Number.NaN : payCountdownTime(o.expireAt);
    let stopped = false;
    let inFlight = false;
    let lastQuery = Number.NEGATIVE_INFINITY;
    let expiredNotified = false;
    let handle = null;
    const finish = () => {
        stopped = true;
        if (handle !== null)
            clearTimer(handle);
        handle = null;
        unsubscribe();
    };
    const check = async () => {
        if (stopped || inFlight)
            return;
        inFlight = true;
        lastQuery = now();
        let s = "pending";
        try {
            s = await o.query();
        }
        catch {
            s = "pending";
        }
        inFlight = false;
        if (stopped)
            return;
        if (s === "paid") {
            finish();
            o.onPaid();
        }
        else if (s === "expired" || s === "cancelled") {
            if (!expiredNotified)
                o.onExpired?.();
            finish();
        }
    };
    /** 一秒一次（仅可见时）：刷新倒计时、到点提示过期、过了宽限就停、到间隔就查单。返回是否继续 */
    const step = () => {
        const t = now();
        const c = payCountdown(Number.isFinite(expireAt) ? expireAt : null, t);
        o.onTick?.(c);
        if (c.expired && !expiredNotified) {
            expiredNotified = true;
            o.onExpired?.();
        }
        if (Number.isFinite(expireAt) && t > expireAt + graceMs)
            return false;
        if (t - lastQuery >= intervalMs)
            void check();
        return true;
    };
    const loop = () => {
        handle = null;
        if (stopped || !visible())
            return; // 不可见：不排下一次，等 visibilitychange 再接上
        if (!step())
            return finish();
        if (!stopped)
            handle = setTimer(loop, 1000);
    };
    const unsubscribe = subscribe(() => {
        if (stopped || !visible() || handle !== null)
            return;
        lastQuery = Number.NEGATIVE_INFINITY; // 回到前台立刻补查（玩家可能刚在支付宝里付完）
        loop();
    });
    loop();
    return { stop: finish };
}
function payCountdownTime(v) {
    return v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
}
/**
 * 排队中的弹窗驱动（站点只负责把 text 放进自己的弹窗）：每秒本地倒数，同时问一次服务端（同一时刻最多一个请求）；
 * 切到后台也每 5 秒问一次，保住位置（15 秒没心跳才出队）。返回 stop()：玩家点「取消排队」/ 关弹窗时调用。
 */
export function watchQueue(o) {
    // shengdian-ok: 排队位置靠心跳保住，后台降到 5 秒一次，玩家关掉弹窗立即 stop()
    const every = o.everyMs ?? 1000;
    const hiddenEvery = o.hiddenEveryMs ?? 5000;
    const doc = o.doc === undefined ? (typeof document === "undefined" ? null : document) : o.doc;
    let position = o.start.position;
    let deadline = Date.now() + o.start.eta_ms;
    let stopped = false;
    let inFlight = false;
    let lastAsk = 0;
    let timer = null;
    const show = () => {
        const etaMs = Math.max(0, deadline - Date.now());
        const view = queueView(position, etaMs);
        o.onText(view.text, { position, etaMs, view });
    };
    const ask = () => {
        if (inFlight || stopped)
            return;
        inFlight = true;
        lastAsk = Date.now();
        o.poll()
            .then((r) => {
            if (stopped)
                return;
            if (r.ready) {
                stop();
                o.onReady();
                return;
            }
            position = r.position;
            deadline = Date.now() + r.etaMs;
            show();
        })
            .catch((e) => o.onError?.(e))
            .finally(() => {
            inFlight = false;
        });
    };
    const tick = () => {
        if (stopped)
            return;
        const hidden = doc?.visibilityState === "hidden";
        if (!hidden)
            show();
        if (Date.now() - lastAsk >= (hidden ? hiddenEvery : every))
            ask();
        timer = setTimeout(tick, every);
    };
    const onVisible = () => {
        if (doc?.visibilityState === "visible")
            ask();
    };
    function stop() {
        stopped = true;
        if (timer)
            clearTimeout(timer);
        doc?.removeEventListener("visibilitychange", onVisible);
    }
    doc?.addEventListener("visibilitychange", onVisible);
    show();
    timer = setTimeout(tick, every);
    return { stop };
}
