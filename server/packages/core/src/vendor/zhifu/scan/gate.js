import { classifyScanClient, hasTouchHint, isLocalJump, regionBlocked, regionOf, scanClientAllowed, scanEarlyMs, } from "../risk/index.js";
/**
 * `/s/` scan gate (owner 11-04), both pay modes: checked only right before an upstream create, so a refused scan
 * never costs an Alipay order. Order: client (Alipay / phone / iPad) → IP (central reputation, else local region)
 * → not too fast after the QR was handed out → per scan IP / order device / order player caps. I/O only via ports.
 * The signed `/s/` token, the no-referrer hand-off page and recording a refusal stay with the host (service / server).
 */
/** Why a scan was refused before any upstream call (stored on the order, counted in the funnel). */
export const SCAN_REJECT_REASONS = [
    "not_alipay",
    "too_fast",
    "rate_ip",
    "rate_device",
    "rate_player",
    "overseas",
    // From the central IP reputation (leichiwaf-verify, owner 11-04): VPN / proxy / hosting, staff block, bad history.
    "anonymous",
    "ip_blocked",
    "ip_risk",
    // Central reputation said deny without naming a reason (owner 11-04: deny, never fall through to allow).
    "reputation",
];
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Central reputation decides (deny without reason → "reputation"); observe-only → logged and the local region gate decides; when it is not configured or does not answer, the local region gate. */
async function ipGate(ports, ip, rules) {
    if (!rules.ipGate)
        return null;
    return ipRegionGate(ports, ip, rules);
}
/**
 * The IP check shared by the scan gate and risk rule `orderGeo` (owner 11-05: domestic-IP check at order creation,
 * no extra page): central reputation first; observe-only or no answer → the offline region gate (observe-only never
 * weakens it). null = allowed.
 */
export async function ipRegionGate(ports, ip, rules) {
    const central = ip && ports.ipRep ? await ports.ipRep.check(ip) : null;
    if (central && !central.observeOnly) {
        if (central.verdict !== "deny")
            return null;
        return central.reason ?? "reputation";
    }
    // Observe-only reputation (owner 11-04): log its verdict, never enforce it — and never let it weaken the owner's
    // domestic-IP rule: the local ip2region gate still decides, exactly as when the reputation is absent.
    if (central?.verdict === "deny")
        console.warn(JSON.stringify({ level: "warn", msg: "scan ip reputation deny (observe only)", reason: central.reason ?? "reputation" }));
    return regionBlocked(regionOf(ip ? ports.ipGeo?.lookup(ip) : null), rules) ? "overseas" : null;
}
/** Refusals that are evidence against the scanning IP (scripted / farmed): report them to the reputation. */
export const SCAN_REJECTS_BAD_FOR_IP = new Set([
    "too_fast",
    "rate_ip",
    "rate_device",
    "rate_player",
]);
/** null = allowed. A phone / tablet jump that is early is held for the rest of the delay (≤ 60 s), not refused. */
export async function gateScan(ports, order, client, rules) {
    // iPad (owner 11-04): Mac UA + the site package's touch hint (zhifu ≥ 5.1 `zt=1`) = tablet, rule allowTablet.
    const kind = classifyScanClient(client.userAgent, hasTouchHint(client.query));
    if (!scanClientAllowed(kind, rules))
        return "not_alipay";
    const phone = isLocalJump(kind, rules);
    const ip = await ipGate(ports, client.ip, rules);
    if (ip)
        return ip;
    const early = scanEarlyMs(order.scanIssuedAt ?? order.createdAt, ports.now(), rules.minScanDelayMs);
    if (early > 0 && !phone)
        return "too_fast";
    // Capped: a mis-set delay must never hold a request for long.
    if (early > 0)
        await (ports.sleep ?? defaultSleep)(Math.min(early, 60000));
    const { limiter } = client;
    if (!limiter)
        return null;
    const windowMs = rules.windowMin * 60000;
    const caps = [
        ["rate_ip", client.ip ? `scan-up:ip:${client.ip}` : null, rules.maxPerIp],
        ["rate_device", order.deviceKey ? `scan-up:${order.deviceKey}` : null, rules.maxPerDevice],
        ["rate_player", `scan-up:p:${order.playerKey}`, rules.maxPerPlayer],
    ];
    const live = caps.filter(([, key, cap]) => key !== null && cap > 0);
    const ok = await Promise.all(live.map(([, key, cap]) => limiter.hit(key ?? "", cap, windowMs)));
    const failed = live.find((_, i) => !ok[i]);
    return failed ? failed[0] : null;
}
