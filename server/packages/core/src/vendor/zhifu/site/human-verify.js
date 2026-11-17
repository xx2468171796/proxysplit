/**
 * 4.12: pay-time human verification (owner 11-01 「点支付先弹滑块验证，再发起订单」).
 * The page solves the central verification service (`LcVerify.open({ action: "pay" })`, leichiwaf edge/hv, one-time
 * token bound to the site's host + action); the site passes it as `SiteCreateInput.hvToken`; the SDK redeems it here and
 * only then tells the center `challenge_passed=1`. The center's `challengeEveryOrder` switch refuses orders without it.
 * Service unreachable → treated as passed (players must never be unable to pay because the verifier is down).
 *
 * 4.12.1: the real call goes through node:http, NOT fetch — Node's fetch silently drops a caller-set `host` header and
 * sends `127.0.0.1:<port>`, so the service (tokens bound to the site host) rejected every token: every payment that
 * had passed the slider failed with 「安全验证已失效」 (GX / F7 2026-11-02). This is the ONE implementation sites use.
 */
import { request } from "node:http";
export const DEFAULT_HV_URL = "http://127.0.0.1:8976";
/** POST JSON with an explicit Host header over node:http. */
function postWithHost(base, path, host, body, timeoutMs) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, base);
        const headers = { host, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) };
        const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST", headers, timeout: timeoutMs }, (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (c) => {
                text += c;
            });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
        });
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", reject);
        req.end(body);
    });
}
async function call(o, token, action) {
    const base = (o.url ?? DEFAULT_HV_URL).replace(/\/$/, "");
    const body = JSON.stringify({ token, action });
    const timeoutMs = o.timeoutMs ?? 2000;
    if (!o.fetch)
        return postWithHost(base, "/__leichiwaf/hv/v1/verify", o.host, body, timeoutMs);
    const res = await o.fetch(`${base}/__leichiwaf/hv/v1/verify`, {
        method: "POST",
        headers: { host: o.host, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, text: await res.text() };
}
/** Redeem a one-time token (direct local call; the service refuses traffic that came through the edge). */
export async function redeemHumanToken(o, token, action = "pay") {
    try {
        const res = await call(o, token, action);
        if (res.status < 200 || res.status >= 300)
            return res.status >= 500 ? "unavailable" : "bad";
        const out = JSON.parse(res.text);
        return out.ok ? "ok" : "bad";
    }
    catch {
        return "unavailable";
    }
}
