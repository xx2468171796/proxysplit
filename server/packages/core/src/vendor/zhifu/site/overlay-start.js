const REFUSE = {
    COOLDOWN: { reason: "cooldown", title: "操作太频繁" },
    PAY_BANNED: { reason: "banned", title: "暂时无法充值" },
    TRUST_REQUIRED: { reason: "trust", title: "暂时无法充值" },
    OUTAGE: { reason: "outage", title: "支付通道维护中" },
    COLLECTION_OFF: { reason: "off", title: "充值暂未开放" },
    AMOUNT_INVALID: { reason: "amount", title: "金额不可用" },
    QUEUE_FULL: { reason: "busy", title: "通道繁忙" },
    CHANNEL_BUSY: { reason: "busy", title: "通道繁忙" },
};
function refused(r) {
    if (r.code === "QUEUED") {
        const q = r.ui?.queue;
        return {
            kind: "queued",
            ahead: Math.max(0, q?.position ?? 0),
            etaMs: Math.max(0, q?.eta_ms ?? 0),
            pollMs: Math.min(5000, Math.max(1000, q?.poll_ms ?? 1500)),
            text: r.message,
        };
    }
    if (r.code === "CHALLENGE_REQUIRED")
        return { kind: "challenge", message: r.message };
    if (r.code === "OPEN_ORDER") {
        return { kind: "open_order", message: r.message, amountCents: r.open?.amountCents ?? null, sameSite: r.open?.sameSite === true };
    }
    const known = REFUSE[r.code];
    if (known)
        return { kind: "refused", ...known, message: r.message, retryAfterSec: r.retryAfterSec ?? null };
    return { kind: "refused", reason: "error", title: "暂时无法充值", message: "下单失败，请稍后再试", retryAfterSec: null };
}
/**
 * `SiteCreateResult` → the overlay's start answer. `centerUrl` = the public center (https). An accepted order
 * without an overlay token (center older than 6.5) is refused rather than half-shown.
 */
export function siteStartResult(r, centerUrl) {
    if (!r.ok)
        return refused(r);
    const o = r.order;
    if (!o.overlayToken || !o.centerOrderNo || !/^https:\/\//.test(centerUrl)) {
        return { kind: "refused", reason: "error", title: "暂时无法充值", message: "支付服务升级中，请稍后再试", retryAfterSec: null };
    }
    return {
        kind: "order",
        orderNo: o.centerOrderNo,
        orderToken: o.overlayToken,
        centerUrl: centerUrl.replace(/\/+$/, ""),
        amountCents: o.amountCents,
        status: "pending",
        expiresAt: o.expireAt,
        payUrl: o.payUrl,
        payExpiresAt: o.expireAt,
        linkKind: o.linkKind,
        jumpHint: o.jumpHint,
        scene: o.scene ?? "unknown",
    };
}
