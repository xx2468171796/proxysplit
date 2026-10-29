/**
 * AI 控制入口鉴权闸 —— 让 tzctl 这类机器调用能以管理员身份打 /api/admin/tongzhi/*,不登后台、不过滑块。
 * (与 huiyuan 的 createAiControl 同一套纪律,本包自带一份,**不跨包 import**:各包必须能独立装。)
 *
 * 两道闸缺一不可:
 *   1. `Authorization: Bearer <token>`,常量时间比较,长度 ≥ minTokenLength(默认 32)
 *   2. 来源 IP 必须 loopback(宿主的 req.ip 经 trust-proxy 还原;nginx 反代来的公网请求进不来,伪造 X-Forwarded-For 无效)
 * 不配 token(或太短)= 通道根本不存在。
 *
 * 宿主用法(Next.js route 里):
 *   const ai = createTongzhiAiControl({ token: process.env.TZ_AI_TOKEN });
 *   const id = ai.authenticate({ ip, headers });   // 命中 → actor = { id: id.sub, source: "cli" };否则走自己的后台会话
 */
import { timingSafeEqual } from "node:crypto";
export const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const isLoopbackIp = (ip) => LOOPBACK_IPS.has(ip);
const first = (v) => (Array.isArray(v) ? v[0] : v);
export function createTongzhiAiControl(opts) {
    const minLen = opts.minTokenLength ?? 32;
    const token = typeof opts.token === "string" ? opts.token.trim() : "";
    const enabled = token.length >= minLen;
    const allowIp = opts.allowIp ?? isLoopbackIp;
    const actorHeader = (opts.actorHeader ?? "x-tz-actor").toLowerCase();
    const want = Buffer.from(token);
    function authenticate(req) {
        if (!enabled)
            return null;
        const auth = first(req.headers.authorization);
        if (typeof auth !== "string" || !auth.startsWith("Bearer "))
            return null;
        if (!allowIp(req.ip))
            return null;
        const given = Buffer.from(auth.slice(7).trim());
        if (given.length !== want.length || !timingSafeEqual(given, want))
            return null;
        const raw = first(req.headers[actorHeader]) ?? "cli";
        const actor = String(raw).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 32) || "cli";
        return { actor, sub: `ai:${actor}` };
    }
    const isBearerAttempt = (req) => { const a = first(req.headers.authorization); return typeof a === "string" && a.startsWith("Bearer "); };
    return { enabled, authenticate, isBearerAttempt };
}
/** 从 Web 标准 Headers 取成 handler 需要的形状 */
export function headersToRecord(h) {
    const out = {};
    h.forEach((v, k) => { out[k.toLowerCase()] = v; });
    return out;
}
