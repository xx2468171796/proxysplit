/**
 * zhifu/site — one site-facing payment interface for both integration modes (AI-START.md).
 *
 *   standalone: this process runs the shared pipeline itself (`zhifu/server`, 6.0.0; mount `SitePay.embedded`).
 *   center:     orders go to zhifu-service through the signed `zhifu/center` client.
 *
 * Everything a site calls (create / get / cancel / notify / pay-config / rules / queue) has the same shape in
 * both modes, so switching is a config change (`PAY_MODE`), not a rewrite. Amounts are integer cents.
 */
import type { PayConfig, PayTier } from "../center/pay-config.ts";
import type { PayUi } from "../center/ui.ts";
export type PayMode = "standalone" | "center";
/** Why an order was refused. Show `message` to the player verbatim (never mention odds). */
export type SitePayFailCode = "COOLDOWN" | "QUEUE_FULL"
/** 4.8 排队中：ui.kind = "queue"（位置 + 预计时间），站点显示后用 queuePoll 轮询，ready 再下单 */
 | "QUEUED"
/** 4.10 有未付订单的玩家要先过滑块：ui 按钮 action "challenge" */
 | "CHALLENGE_REQUIRED" | "PAY_BANNED" | "AMOUNT_INVALID" | "COLLECTION_OFF" | "CHANNEL_BUSY"
/** 5.4 支付通道异常：ui.kind = "outage"，站点用原生弹窗 / 页面显示，不排队、不出码 */
 | "OUTAGE"
/** 4.6: the player has an open order — show `open` with 「继续支付 / 取消后重新下单」 (openOrderPrompt). */
 | "OPEN_ORDER"
/** 4.6: trust gate (bind a phone first / account too new) — show `message`. */
 | "TRUST_REQUIRED" | "ERROR";
/** 4.6: the player's existing open order (OPEN_ORDER refusal). */
export interface OpenOrderInfo {
    /** Site order number (same site: resume it with `resume(userId, orderNo)`). */
    orderNo: string;
    amountCents: number;
    /** false = the open order is on another site (can only be cancelled from here). */
    sameSite: boolean;
    siteName: string | null;
    expireAt: string;
}
/** 4.6: numbers behind 「未支付将计入未付次数…」 (render with `unpaidNoticeText`). */
export interface SiteUnpaidStatus {
    today: number;
    streak: number;
    nextWaitSec: number;
    leftBeforeBan: number;
}
export interface SiteCreateInput {
    /** The player's id on this site. */
    userId: string;
    /** What the player pays (cents). Checked against pay-config min / max before anything is created. */
    amountCents: number;
    /** Shown on the cashier; standalone without it uses the disguise table. */
    subject?: string;
    /** Your business data; handed back unchanged in `onPaid(e).meta` (both modes). Keep it JSON. */
    meta?: Record<string, unknown>;
    /**
     * 6.7.1 center mode: the overlay's `PayStartBody.requestId`. Same user + same requestId = same site order number
     * (deterministic), so a re-submit after a lost response / queue turn / slider returns the order already created
     * instead of opening a second one (the center is idempotent on site_order_no). Omit = a fresh number each call.
     */
    requestId?: string;
    /** Phone number (cross-site cooldown / ban key; center 4.14: also shown masked in the payment-center admin). */
    phone?: string | null;
    /** 4.14 center: payer profile for the payment-center admin (昵称 · 用户名, fuzzy search). Standalone ignores it. */
    username?: string | null;
    nickname?: string | null;
    /** 会员中心 account id (center: preferred cross-site identity). */
    huiyuanId?: string;
    clientIp?: string;
    /** Line id from the line picker (standalone: numeric gateway line). */
    line?: string;
    /** 4.6: the request's `x-device-fingerprint` header (yanzheng device client). Pass it whenever present. */
    deviceFingerprint?: string | null;
    /** 4.6: seconds since the account was created (trust gate). */
    accountAgeSec?: number | null;
    /** 4.6: "cancel" = the player chose 「取消后重新下单」 on the OPEN_ORDER prompt. Default "ask". */
    onOpen?: "ask" | "cancel";
    /** 4.7 full context (send once, every server rule reads it): the request's User-Agent. */
    userAgent?: string | null;
    /** 6.2 client hint from the page: `navigator.maxTouchPoints > 1` (iPad with a Mac UA). */
    touchHint?: boolean | null;
    /** 4.7: account creation time (Date or ISO); preferred over accountAgeSec. */
    accountCreatedAt?: Date | string | null;
    /** 4.7: the phone was verified by SMS on this site. */
    phoneVerified?: boolean | null;
    /** 4.10: the player passed this site's slider just now (only after a CHALLENGE_REQUIRED refusal). */
    challengePassed?: boolean;
    /**
     * 4.12: one-time token from the central human-verification service (`LcVerify.open({ action: "pay" })` on the page).
     * Needs `humanVerify` configured (center side / PAY_HV_HOST); the SDK redeems it and sets challengePassed itself.
     */
    hvToken?: string;
    /** 6.5 PayCreateRequest extras (center only): opaque session id, VIP / player level, lifetime recharge (cents). */
    sessionId?: string | null;
    vipLevel?: number | null;
    playerLevel?: number | null;
    totalRechargedCents?: number | null;
    /** 6.5 extensible decision data (`zhifu/contracts` paySignalsSchema) — server-side facts only, never from the page. */
    signals?: Record<string, unknown> | null;
}
/** What the browser needs to draw the QR dialog (feed it to `zhifu/client/pay-session`). */
export interface SiteOrder {
    /** The id the site shows and polls with (center: the site order number; standalone: zhifu order number). */
    orderNo: string;
    amountCents: number;
    payUrl: string;
    checkoutUrl: string | null;
    payTip: string | null;
    /** 6.2 presentation: kind of payUrl (h5 / alipay_qr / page / wx_qr); null = unknown (older center / standalone). */
    linkKind: "h5" | "alipay_qr" | "page" | "wx_qr" | "wx_h5" | null;
    /** 6.2: line under the phone jump button from the center config; pass to `payJump({ hint })`. null = default. */
    jumpHint: string | null;
    /** ISO time the QR stops working; drive the countdown from it. */
    expireAt: string;
    nextOrderTip: string | null;
    /** center only: token for `watchOrder` (SSE); standalone polls `getOrder`. */
    sessionToken: string | null;
    queuedMs: number;
    /** 4.6: this is the player's existing open order (same site, same amount), not a new one. */
    reused: boolean;
    /** 4.6: unpaid counters for the QR dialog notice; null when the rules are off. */
    unpaid: SiteUnpaidStatus | null;
    /** 4.6: ready-made 「请在 2 分钟内完成支付；未支付将计入未付次数…」 (PAY_COPY.unpaidNotice), or null. */
    notice: string | null;
    /** 4.7 server-driven prompt (inline notice + 「我已支付」); render with the site's one renderer. */
    ui: PayUi | null;
    /** 6.5 unified overlay (center only): the center order number + its order-bound token + payer scene. */
    centerOrderNo?: string | null;
    overlayToken?: string | null;
    scene?: "desktop" | "mobile" | "tablet" | "unknown" | null;
}
export type SiteCreateResult = {
    ok: true;
    order: SiteOrder;
} | {
    ok: false;
    code: SitePayFailCode;
    message: string;
    retryAfterSec?: number;
    open?: OpenOrderInfo;
    ui?: PayUi | null;
};
export type SiteOrderStatus = "pending" | "paid" | "expired" | "cancelled";
export interface SiteOrderState {
    orderNo: string;
    status: SiteOrderStatus;
    paidAt: string | null;
    /** 4.7: check → result toast; query of a pending order → the 「订单还未支付」 dialog (show only on return). */
    ui?: PayUi | null;
    /** 5.4: payment is down for this site — close the QR / countdown and show `ui` (kind "outage") at once. */
    outage?: boolean;
}
/** The single fulfil hook. Credit exactly once per `idempotencyKey` (DB unique key); a replay must be a no-op. */
export interface PaidEvent {
    mode: PayMode;
    orderNo: string;
    idempotencyKey: string;
    userId: string;
    /** Order total (cents) — credit by this. */
    amountCents: number;
    /** Money actually received (cents). */
    paidCents: number;
    meta: Record<string, unknown>;
    /** Paid after the QR expired (still credit: the money was taken). */
    late: boolean;
    paidAt: Date;
}
/** 4.8 排队页轮询结果：ready = 轮到了，立刻用同样金额再下单（20 秒内直接放行） */
export interface SiteQueuePoll {
    ready: boolean;
    position: number;
    etaMs: number;
    text: string;
    /** 5.4: payment went down while queued (the center already took the player out of line): show `ui`. */
    outage?: boolean;
    ui?: PayUi | null;
}
/** 5.16 pay pre-check result (same shape on the wire: `{ outage, ui }`). */
export interface SitePayStatus {
    outage: boolean;
    ui: PayUi | null;
}
export interface SiteQueue {
    enabled: boolean;
    waitMs: number;
    ahead: number;
    text: string;
}
export interface NotifyReply {
    status: number;
    body: string;
}
/** The interface both modes return. */
export interface SitePay {
    readonly mode: PayMode;
    createOrder(input: SiteCreateInput): Promise<SiteCreateResult>;
    /** Display only (dialog polling). Never credit from it — credit happens in `onPaid`. null = not found / not yours. */
    getOrder(userId: string, orderNo: string): Promise<SiteOrderState | null>;
    cancel(userId: string, orderNo: string): Promise<boolean>;
    /** 4.6 「继续支付」: same order, fresh QR when the old one expired; never counts as a new order. */
    resume(userId: string, orderNo: string): Promise<SiteCreateResult>;
    /** 4.6 「我已支付」: asks the channel right now; null = not yours. */
    check(userId: string, orderNo: string): Promise<SiteOrderState | null>;
    /** Tiers, min / max, collection switch (central when reachable, else your `local`). Never throws. */
    payConfig(): Promise<PayConfig>;
    tiers(): Promise<PayTier[]>;
    /** null = ok, else the player-facing reason. */
    checkAmount(amountCents: number): Promise<string | null>;
    /** Lines for the「支付须知」dialog shown before paying. */
    rulesLines(): Promise<string[]>;
    /** Global order queue (「前面还有 N 人」). */
    queue(): Promise<SiteQueue>;
    /** 4.8 排队中的玩家每秒问一次（不建单、不计下单次数）：前面几位、预计时间、轮到没有 */
    queuePoll(player: {
        userId: string;
        phone?: string | undefined;
        huiyuanId?: string | undefined;
    }): Promise<SiteQueuePoll>;
    /**
     * 5.16 付款前置检查（§21.4）：本站此刻是不是「通道异常」。站点开一个公开只读路由（如 GET /api/pay/status）
     * 原样回给前端，前端点充值第一步 `ensurePayOpen` 调它。缓存 ~5 秒、不计限流、出错 = 开着。
     */
    payStatus(): Promise<SitePayStatus>;
    /**
     * Raw center notify body in, HTTP reply out (`source` "center"). 6.0: "gateway" is gone — standalone callbacks
     * are per channel via `embedded.callback`. Keep the center notify mounted after switching so in-flight orders credit.
     */
    handleNotify(source: "center" | "gateway", rawBody: string, signature?: string): Promise<NotifyReply>;
    /** 6.0 standalone side (null without `standalone` options): mount `GET /s/:token` and `POST /channel-callback/:code`. */
    readonly embedded: import("./standalone.ts").EmbeddedPay | null;
    /** Which notify sources this instance can accept (configured sides). */
    readonly notifySources: ReadonlyArray<"center" | "gateway">;
    stop(): void;
}
/** Where center-mode orders are remembered on the site (user, amount, meta), keyed by the site order number. */
export interface SiteOrderRecord {
    siteOrderNo: string;
    userId: string;
    amountCents: number;
    meta: Record<string, unknown>;
}
/** Production: a table with a unique key on site_order_no. Tests: `memoryOrderBook()`. */
export interface SiteOrderBook {
    save(record: SiteOrderRecord): Promise<void>;
    load(siteOrderNo: string): Promise<SiteOrderRecord | null>;
    /**
     * 6.8 optional: the row `save` just wrote will never be paid — the center reused the player's earlier unpaid order,
     * or refused a call that has no requestId to retry with. Mark it superseded / cancelled (never delete a row that
     * might be paid; only rows still pending). Not implemented = the row stays pending as before 6.8.
     */
    discard?(siteOrderNo: string, reason: "reused" | "refused"): Promise<void>;
}