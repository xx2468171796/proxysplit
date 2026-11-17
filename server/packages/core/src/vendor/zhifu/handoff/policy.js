import { BlockList, isIP } from "node:net";
/**
 * Channel hand-off standard (owner 2026-11-04, learned from dissecting 章鱼哥1103 — knowledge ev:1203 / ev:1207):
 * what the payment company (Alipay / WeChat behind any channel) may see of an order. Every adapter receives
 * only a `CreateInput` that passed `handoffViolations`; docs = INTEGRATION §6.0「跳转与防穿透风控标准」.
 * Same code in both modes: zhifu-service (center) and `zhifu/server` (standalone) build inputs only here.
 *
 * 1. Neutral subject / body: only the channel-generated text (`subjectFormat`) or 订单号：<尝试号>, never the site's
 *    order title; the denylist below + per-site terms re-check it.
 * 2. notify_url / return_url only on the payment-center domain (never a game site).
 * 3. Client hand-off = our page doing `location.href` with `Referrer-Policy: no-referrer` (never a server 302) —
 *    enforced by the /s/ route (zhifu-service `apps/api/src/routes/scan.ts`; standalone `zhifu/server`).
 * 4. Upstream order expiry aligned to our QR TTL (sent when the channel API has an expiry field).
 * 5. The real payer IP (scan IP first) when the channel API has a client-IP field — never 127.0.0.1 / private.
 * 6. Scan-to-create gate before creating upstream orders (per-site switch; judgement in `zhifu/risk`).
 * All functions here are pure.
 */
/** Words that tie an order to a game / recharge business. Matched case-insensitively as substrings. */
export const SUBJECT_DENYLIST = [
    "游戏",
    "开箱",
    "箱子",
    "盲盒",
    "抽奖",
    "皮肤",
    "饰品",
    "武器",
    "钻石",
    "金币",
    "点券",
    "充值",
    "代充",
    "竞猜",
    "博彩",
    "彩票",
    "下注",
    "赌",
    "幸运",
    "夺宝",
    "roll",
    "cs2",
    "csgo",
    "cs:go",
    "steam",
    "skin",
    "game",
    "zygskins",
    "5eplay",
    "gxcs",
];
/** Fallback upstream text when a channel has no `subjectFormat` and the order's own subject is not neutral. */
export function neutralSubject(attemptNo) {
    return `订单号：${attemptNo}`;
}
/** Denylisted / site-specific terms found in `text` (lower-cased, de-duplicated). */
export function subjectViolations(text, extraTerms = []) {
    const hay = text.toLowerCase();
    const found = new Set();
    // Per-site terms need ≥ 2 chars (a one-letter site name would match everything); the denylist is curated.
    const extra = extraTerms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
    for (const t of [...SUBJECT_DENYLIST, ...extra])
        if (hay.includes(t))
            found.add(t);
    return [...found];
}
/** Host-only terms of a URL / domain list (e.g. `gx.zygskins.cn` → also `zygskins`), for the per-site denylist. */
export function siteTerms(input) {
    const out = new Set();
    if (input.name && input.name.trim().length >= 2)
        out.add(input.name.trim());
    for (const raw of input.urls ?? []) {
        const host = hostOf(raw);
        if (!host || isIP(host))
            continue;
        out.add(host);
        const labels = host.split(".");
        // Registrable label ("zygskins" of gx.zygskins.cn); skips one-letter / TLD noise.
        const core = labels.length >= 2 ? labels[labels.length - 2] : undefined;
        if (core && core.length >= 3)
            out.add(core);
    }
    return [...out];
}
function hostOf(raw) {
    if (!raw)
        return null;
    try {
        return new URL(raw).hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
/** True when `url` is https on exactly the payment-center host (`publicBaseUrl`). */
export function isCenterUrl(url, centerBase) {
    const host = hostOf(url);
    const center = hostOf(centerBase);
    if (!host || !center || host !== center)
        return false;
    // Plain http only for a local dev center (http://127.0.0.1:7480).
    return url.startsWith("https://") || centerBase.startsWith("http://");
}
const NOT_PUBLIC = new BlockList();
for (const [net, bits] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
    ["192.0.0.0", 24],
    ["198.18.0.0", 15],
    ["224.0.0.0", 3],
])
    NOT_PUBLIC.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
    ["::", 127],
    ["64:ff9b::", 96],
    ["2001:db8::", 32],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
])
    NOT_PUBLIC.addSubnet(net, bits, "ipv6");
/** The IP as-is when it is a public address; loopback / private / malformed → null (never send 127.0.0.1). */
export function publicIp(raw) {
    const ip = raw?.trim().replace(/^::ffff:(?=\d+\.)/i, "");
    if (!ip)
        return null;
    const family = isIP(ip);
    if (family === 0)
        return null;
    return NOT_PUBLIC.check(ip, family === 4 ? "ipv4" : "ipv6") ? null : ip;
}
/**
 * Payer IP to pass upstream: on a scan-to-create order ONLY the Alipay scan IP (the device that pays; the
 * ordering IP may be another device), otherwise the ordering IP. Not public → null (send nothing).
 */
export function payerIpOf(order) {
    return order.scanToCreate ? publicIp(order.scanIp) : publicIp(order.clientIp);
}
/** Upstream order expiry = our QR expiry: min(order expiry, now + qrTtlSec); no TTL rule → the order's. */
export function upstreamExpiry(input) {
    if (!input.qrTtlSec)
        return input.orderExpiresAt;
    const qr = new Date(input.now.getTime() + input.qrTtlSec * 1000);
    return qr < input.orderExpiresAt ? qr : input.orderExpiresAt;
}
/** The only way a `CreateInput` is built for a real upstream call. */
export function buildHandoffInput(s) {
    // Allowlist: upstream only ever sees the channel-generated text or 订单号：<尝试号> — never the site's title.
    const own = s.generatedSubject;
    const subject = own && !subjectViolations(own, s.siteTerms).length ? own : neutralSubject(s.attemptNo);
    return {
        attemptNo: s.attemptNo,
        amountCents: s.amountCents,
        subject,
        notifyUrl: `${s.centerBase.replace(/\/$/, "")}/channel-callback/${s.channelCode}`,
        returnUrl: s.orderReturnUrl && isCenterUrl(s.orderReturnUrl, s.centerBase) ? s.orderReturnUrl : null,
        line: s.line,
        isSplit: s.isSplit,
        clientIp: publicIp(s.payerIp),
        expiresAt: s.expiresAt,
        scene: s.scene ?? "unknown",
        wantLink: s.wantLink ?? null,
    };
}
/** Contract check of a built input; [] = compliant. Used right before `adapter.create` (fail closed). */
export function handoffViolations(input, centerBase, extraTerms = []) {
    const out = [];
    const bad = subjectViolations(input.subject, extraTerms);
    if (bad.length)
        out.push(`商品描述含敏感词：${bad.join("、")}`);
    if (!isCenterUrl(input.notifyUrl, centerBase))
        out.push("notify_url 不在支付中心域名");
    if (input.returnUrl && !isCenterUrl(input.returnUrl, centerBase))
        out.push("return_url 不在支付中心域名");
    if (input.clientIp !== null && publicIp(input.clientIp) === null)
        out.push("付款人 IP 不是公网地址");
    return out;
}
