/**
 * 服务端下发的提示（4.7，业主 2026-11-01「以后支付新功能站点零改动」）。
 *
 * zhifu-service 在每个下单 / 查单 / 被拒的响应里带一个 `ui` 块；站点只实现**一个渲染器**：
 * 把 `kind` 映射到自己的弹窗 / toast / 行内文字，把 `buttons[].action` 映射到 SDK 调用。
 * 文案、按钮、什么时候弹都由服务端决定，改文案或加新提示只部署 zhifu-service，不动站点。
 *
 * 契约小而稳：只有下面这几个字段；`v` 变了才需要站点改渲染器（新增字段一律可选、站点忽略不认识的）。
 */
import { formatWait } from "../order/cooldown.js";
export const PAY_UI_VERSION = 1;
const close = (label = "我知道了") => ({ label, action: "close", primary: true });
/** 4.15 业主 11-04：取消 / 离开都要先确认，提醒会丢位置 */
export const PAY_CANCEL_CONFIRM = "取消后需要重新排队，确定取消？";
/** 秒 → mm:ss（超过 1 小时 h:mm:ss） */
export function mmss(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const pad = (n) => String(n).padStart(2, "0");
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
/** 倒数剩余秒（没有倒数 = null） */
export function countdownLeftSec(ui, now = Date.now()) {
    if (!ui.countdown)
        return null;
    const until = Date.parse(ui.countdown.until);
    return Number.isFinite(until) ? Math.max(0, Math.ceil((until - now) / 1000)) : null;
}
/** 站点每秒调用：带倒数的 ui → 当前该显示的正文 */
export function countdownBody(ui, now = Date.now()) {
    const left = countdownLeftSec(ui, now);
    return left === null || !ui.countdown ? ui.body : ui.countdown.text.split("{mmss}").join(mmss(left));
}
function withCountdown(base, untilMs, text, now) {
    const countdown = { until: new Date(untilMs).toISOString(), text };
    return { ...base, body: countdownBody({ body: text, countdown }, now), countdown };
}
/**
 * 二维码弹窗里常驻的一行（4.15 业主 11-04：实时倒数 + 「请勿重复获取二维码」）+ 「我已支付」「取消订单」（先确认）。
 * 同一笔单重开弹窗 / 刷新 / 再点充值，服务端都回同一张二维码，站点照这个 ui 接着倒数。
 */
export function uiPayNotice(input) {
    const now = input.now ?? Date.now();
    const u = input.unpaid;
    let text = "请在 {mmss} 内完成支付，请勿重复获取二维码，超时需重新排队。";
    if (u && u.nextWaitSec > 0) {
        const ban = u.leftBeforeBan > 0 && u.leftBeforeBan <= 3 ? `，再 ${u.leftBeforeBan} 次未付将暂停支付权限` : "";
        text += `未支付将计入未付次数（今日已 ${u.today} 次，本单未付需等 ${formatWait(u.nextWaitSec)}才能再下单${ban}）`;
    }
    const base = {
        v: PAY_UI_VERSION,
        kind: "inline",
        tone: "info",
        buttons: [
            { label: "我已支付", action: "query", ref: input.siteOrderNo, primary: true },
            { label: "取消订单", action: "cancel", ref: input.siteOrderNo, confirm: PAY_CANCEL_CONFIRM },
        ],
    };
    return withCountdown(base, Date.parse(input.expireAt), text, now);
}
/** 4.15 二维码到点了（订单还在）：只给一个「重新获取」，服务端按每 10 分钟次数上限放行 */
export function uiQrExpired(input) {
    return {
        v: PAY_UI_VERSION,
        kind: "dialog",
        tone: "warn",
        title: "二维码已过期",
        body: "二维码已过期，如需继续支付请点「重新获取」。请勿频繁获取，次数过多需等待一段时间。",
        buttons: [
            { label: "重新获取", action: "resume", ref: input.siteOrderNo, primary: true },
            { label: "取消订单", action: "cancel", ref: input.siteOrderNo, confirm: PAY_CANCEL_CONFIRM },
        ],
    };
}
/** 4.15 下单 / 重新获取过于频繁（IP / 设备 / 次数冷却）：实时倒数，到点可再试 */
export function uiCooldown(input) {
    const now = input.now ?? Date.now();
    const base = { v: PAY_UI_VERSION, kind: "dialog", tone: "warn", title: "请稍后再试", buttons: [close()] };
    return withCountdown(base, now + Math.max(1, input.waitSec) * 1000, input.text ?? "下单过于频繁，请 {mmss} 后再试", now);
}
/** 已有一笔未付订单 */
export function uiOpenOrder(input) {
    const where = input.sameSite || !input.siteName ? "本站" : `「${input.siteName}」`;
    const amount = (input.amountCents / 100).toFixed(2);
    const buttons = [];
    if (input.sameSite)
        buttons.push({ label: "继续支付", action: "resume", ref: input.siteOrderNo, primary: true });
    buttons.push({
        label: "取消后重新下单",
        action: "cancel",
        retry: true,
        ...(input.sameSite ? { ref: input.siteOrderNo } : {}),
        primary: !input.sameSite,
    });
    return {
        v: PAY_UI_VERSION,
        kind: "dialog",
        tone: "warn",
        title: "你有一笔未支付的订单",
        body: `你在${where}还有一笔 ${amount} 元的订单未支付，可以继续支付，或取消后重新下单。`,
        buttons,
    };
}
/** 被拦（冷却 / 封禁 / 排队满 / 设备 / IP / 信任 / 金额…）：正文 = 服务端原话 */
export function uiBlocked(message) {
    return { v: PAY_UI_VERSION, kind: "dialog", tone: "warn", title: "暂时无法下单", body: message, buttons: [close()] };
}
/** 5.4 通道异常默认文案（真文案由支付中心后台「支付中断」配置下发，这里只是兜底） */
export const PAY_OUTAGE_TITLE = "支付通道异常";
export const PAY_OUTAGE_BODY = "支付渠道异常，正在抢修，恢复后会第一时间通知。可以联系官方代理充值 微信：yanF1149 / 或 ZaiXiangJian08 有其他疑问联系官方客服：zyg69996";
/** 5.4 支付通道异常（站点原生弹窗 / 页面；不排队、不出码） */
export function uiOutage(input = {}) {
    return {
        v: PAY_UI_VERSION,
        kind: "outage",
        tone: "error",
        title: input.title?.trim() || PAY_OUTAGE_TITLE,
        body: input.body?.trim() || PAY_OUTAGE_BODY,
        buttons: [close()],
    };
}
/** 5.4 这个 ui 是不是「通道异常」（站点据此关掉二维码 / 倒计时 / 排队，换成异常提示） */
export function isOutageUi(ui) {
    return ui?.kind === "outage";
}
/** 排队中（4.8）：站点每秒倒数 eta、poll_ms 后同参数再提交下单；「取消排队」= 关掉并通知服务端离开 */
export function uiQueued(input) {
    return {
        v: PAY_UI_VERSION,
        kind: "queue",
        tone: "info",
        title: "排队中",
        body: input.text,
        buttons: [{ label: "取消排队", action: "close", confirm: PAY_CANCEL_CONFIRM }],
        queue: { position: input.position, eta_ms: input.etaMs, poll_ms: input.pollMs ?? 300 },
    };
}
/** 排队预计时间：始终按秒显示（业主 11-05：「预计 3 秒」；≥ 60 秒带分钟），至少 1 秒 */
export function queueEtaText(etaMs) {
    const s = Math.max(1, Math.ceil(etaMs / 1000));
    return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}
/** 排队耐心提示（业主 11-05） */
export const QUEUE_PATIENCE = "请耐心等待，离开或取消需重新排队。";
/**
 * 排队文案（站点本地倒数时用同一句话，和服务端一致）。6.3 业主 11-05：前面人数始终显示（含 0），预计秒数始终显示。
 */
export function queueLine(position, etaMs) {
    return `排队中，前面还有 ${Math.max(0, position)} 人，预计 ${queueEtaText(etaMs)}。${QUEUE_PATIENCE}`;
}
/** 「我已支付」的结果 */
export function uiCheckResult(status) {
    if (status === "paid")
        return { v: PAY_UI_VERSION, kind: "toast", tone: "success", body: "充值成功，已到账", buttons: [] };
    if (status === "pending" || status === "partial") {
        return {
            v: PAY_UI_VERSION,
            kind: "toast",
            tone: "info",
            body: "暂未查到付款。如已扣款请稍等片刻，到账后会自动通知；二维码失效前仍可继续支付。",
            buttons: [],
        };
    }
    return { v: PAY_UI_VERSION, kind: "toast", tone: "warn", body: "订单已结束，如已付款请联系客服", buttons: [] };
}
/** 从支付宝切回来还没付（查单响应带着，站点只在「页面重新可见」时显示） */
export function uiReturnedUnpaid(input) {
    return {
        v: PAY_UI_VERSION,
        kind: "dialog",
        tone: "info",
        title: "订单还未支付",
        body: `检测到这笔 ${(input.amountCents / 100).toFixed(2)} 元的订单还没有完成支付，二维码有效期内可继续支付。`,
        buttons: [
            { label: "继续支付", action: "resume", ref: input.siteOrderNo, primary: true },
            { label: "稍后再说", action: "close" },
        ],
    };
}
function parseQueue(raw) {
    const q = raw && typeof raw === "object" ? raw : null;
    if (!q || !Number.isFinite(Number(q.position)) || !Number.isFinite(Number(q.eta_ms)))
        return null;
    return {
        position: Math.max(0, Math.floor(Number(q.position))),
        eta_ms: Math.max(0, Number(q.eta_ms)),
        poll_ms: Math.min(10000, Math.max(200, Number(q.poll_ms) || 500)),
    };
}
function kindOf(raw, hasQueue) {
    if (raw === "dialog" || raw === "toast" || raw === "inline" || raw === "outage")
        return raw;
    return raw === "queue" && hasQueue ? "queue" : "dialog";
}
const BUTTON_ACTIONS = new Set(["resume", "cancel", "query", "close", "open_url", "challenge"]);
function parseButton(b) {
    const out = { label: String(b.label), action: b.action };
    if (b.primary === true)
        out.primary = true;
    if (typeof b.ref === "string")
        out.ref = b.ref;
    if (b.retry === true)
        out.retry = true;
    if (typeof b.url === "string" && /^https?:\/\//.test(b.url))
        out.url = b.url;
    if (typeof b.confirm === "string" && b.confirm)
        out.confirm = b.confirm.slice(0, 200);
    return out;
}
function parseButtons(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((b) => b && typeof b.label === "string" && BUTTON_ACTIONS.has(String(b.action)))
        .map(parseButton);
}
function parseCountdown(raw) {
    const cd = raw && typeof raw === "object" ? raw : null;
    if (!cd || typeof cd.text !== "string" || typeof cd.until !== "string")
        return null;
    return Number.isFinite(Date.parse(cd.until)) ? { until: cd.until, text: cd.text } : null;
}
/** 站点收到的 ui 不可信时（版本更高 / 字段坏）兜底：只显示正文 + 关闭 */
export function parsePayUi(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    if (typeof o.body !== "string")
        return null;
    const queue = parseQueue(o.queue);
    const kind = kindOf(o.kind, queue !== null);
    const tone = o.tone === "success" || o.tone === "warn" || o.tone === "error" ? o.tone : "info";
    const buttons = parseButtons(o.buttons);
    const ui = { v: Number(o.v) || PAY_UI_VERSION, kind, tone, body: o.body, buttons };
    if (typeof o.title === "string")
        ui.title = o.title;
    if (kind === "queue" && queue)
        ui.queue = queue;
    const countdown = parseCountdown(o.countdown);
    if (countdown)
        ui.countdown = countdown;
    if ((kind === "dialog" || kind === "outage") && ui.buttons.length === 0)
        ui.buttons = [close()];
    return ui;
}
export function runPayUiAction(b, h) {
    switch (b.action) {
        case "resume":
            return b.ref ? h.resume(b.ref) : h.close();
        case "cancel":
            if (b.retry)
                return h.cancelAndRetry(b.ref);
            return b.ref && h.cancel ? h.cancel(b.ref) : h.close();
        case "query":
            return b.ref ? h.query(b.ref) : h.close();
        case "open_url":
            return b.url && h.openUrl ? h.openUrl(b.url) : h.close();
        case "challenge":
            return h.challenge ? h.challenge() : h.close();
        default:
            return h.close();
    }
}
/**
 * 4.13（业主 11-03「排队时不要拉二维码、倒计时实时、点我知道了不能就没了」）：站点把中心的拒绝换成玩家提示的唯一入口。
 * 优先用服务端下发的 `details.ui`；没有 / 坏了时：QUEUED + `details.queue` → 排队提示（kind queue，站点继续轮询、轮到自动再下单），
 * 绝不退成「暂时无法下单 + 我知道了」（那会让排队中的玩家点一下就丢单）；其余 → uiBlocked(message)。
 */
export function refusalPayUi(code, message, details) {
    const d = details ?? {};
    const sent = parsePayUi(d.ui);
    if (code === "PAY_OUTAGE")
        return outageOf(sent, message);
    if (sent && !(code === "QUEUED" && sent.kind !== "queue" && parseQueue(d.queue)))
        return sent;
    const q = parseQueue(d.queue);
    if (code === "QUEUED" && q) {
        return uiQueued({ position: q.position, etaMs: q.eta_ms, pollMs: q.poll_ms, text: message || queueLine(q.position, q.eta_ms) });
    }
    if (sent)
        return sent;
    const cooling = cooldownOf(code, d);
    if (cooling)
        return cooling;
    if (code === "OPEN_ORDER_EXISTS")
        return openOrderOf(d);
    return uiBlocked(message || "暂时无法下单");
}
function openOrderOf(d) {
    return uiOpenOrder({
        siteOrderNo: String(d.site_order_no ?? ""),
        amountCents: Number(d.amount_cents ?? 0),
        sameSite: d.same_site === true,
        siteName: typeof d.site_name === "string" ? d.site_name : null,
    });
}
function outageOf(sent, message) {
    if (sent?.kind === "outage")
        return sent;
    return uiOutage({ title: sent?.title ?? null, body: sent?.body || message });
}
function cooldownOf(code, d) {
    if (code !== "COOLDOWN" && code !== "RATE_LIMITED")
        return null;
    const wait = Number(d.wait_sec ?? d.retry_after_sec);
    return Number.isFinite(wait) && wait > 0 ? uiCooldown({ waitSec: wait }) : null;
}
/** 5.4 这条拒绝是不是「支付通道异常」（站点显示原生异常提示，不排队、不出码、不算失败重试） */
export function isOutageRefusal(code, details) {
    return code === "PAY_OUTAGE" || parsePayUi(details?.ui)?.kind === "outage";
}
/** 这条拒绝是不是「还在排队」（站点据此保持下单流程，不当失败收尾） */
export function isQueuedRefusal(code, details) {
    return code === "QUEUED" || parsePayUi(details?.ui)?.kind === "queue";
}
