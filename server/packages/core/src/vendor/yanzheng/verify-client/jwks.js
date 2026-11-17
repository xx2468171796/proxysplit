/**
 * 结果票据(EdDSA / Ed25519 JWS)离线核验 + JWKS 缓存。
 * 缓存 10 分钟;遇到不认识的 kid 立刻重拉一次(服务端轮换钥匙),但两次重拉至少隔 30 秒,防止被伪造 kid 刷爆。
 * 拉取失败退避:5 秒起翻倍、封顶 5 分钟,退避期间不再打验证服务(直接按不可用处理,手里有旧钥匙仍可用旧钥匙验)。
 */
import { createPublicKey, verify } from "node:crypto";
export const ISSUER = "leichiwaf-verify";
const CACHE_MS = 600000;
const MIN_REFRESH_MS = 30000;
const BACKOFF_START_MS = 5000;
const BACKOFF_MAX_MS = 300000;
function decodeJson(part) {
    if (!part)
        return null;
    try {
        const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
        return v && typeof v === "object" ? v : null;
    }
    catch {
        return null;
    }
}
function toKeys(raw) {
    const out = new Map();
    const keys = raw && typeof raw === "object" ? raw.keys : undefined;
    if (!Array.isArray(keys))
        return out;
    for (const k of keys) {
        if (!k || typeof k !== "object")
            continue;
        const jwk = k;
        if (typeof jwk.kid !== "string" || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string")
            continue;
        out.set(jwk.kid, createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" }));
    }
    return out;
}
function isPayload(p) {
    return typeof p.aud === "string" && (p.typ === "captcha" || p.typ === "otp") && typeof p.exp === "number" && typeof p.jti === "string";
}
export function createJwksVerifier(fetchJwks, now) {
    let keys = new Map();
    let fetchedAt = 0;
    let backoffMs = 0;
    let retryAt = 0;
    let inflight = null;
    async function fetchOnce() {
        try {
            const next = toKeys(await fetchJwks());
            // 200 但一把可用钥匙都没有(代理错误页 / `{}` / `{"keys":[]}`)= 拉取失败:
            // 以前照单全收,好钥匙被空表顶掉,之后 30 秒内真票全判「无效」(site-otp 还会因此把玩家的码烧掉)。
            // 正常的验证服务不可能一把钥匙都不发。
            if (next.size === 0)
                throw new Error("jwks empty");
            keys = next;
            fetchedAt = now();
            backoffMs = 0;
        }
        catch (e) {
            backoffMs = Math.min(backoffMs ? backoffMs * 2 : BACKOFF_START_MS, BACKOFF_MAX_MS);
            retryAt = now() + backoffMs;
            throw e;
        }
    }
    /**
     * 并发合并成一次拉取:fetchedAt 要等响应回来才写,期间每个验票请求都会判「该重拉」,
     * 缓存到期那一刻的并发量就是打到验证服务的请求量(失败时还各自把退避翻一倍)。
     */
    function refresh() {
        if (inflight)
            return inflight;
        if (now() < retryAt)
            return Promise.reject(new Error("jwks backoff"));
        inflight = fetchOnce().finally(() => {
            inflight = null;
        });
        return inflight;
    }
    async function keyFor(kid) {
        const stale = now() - fetchedAt > CACHE_MS;
        const want = stale || (!keys.has(kid) && now() - fetchedAt > MIN_REFRESH_MS);
        if (want) {
            try {
                await refresh();
            }
            catch (e) {
                // 手里已有这把钥匙就先用着(只是过了缓存期);没有才算不可用
                if (!keys.has(kid))
                    throw e;
            }
        }
        return keys.get(kid) ?? null;
    }
    /** 验签名 + iss + aud + exp。不合法返回 null;JWKS 拉不到会抛(调用方按故障方向处理) */
    async function verifyToken(token, audience) {
        const parts = token.split(".");
        if (parts.length !== 3)
            return null;
        const head = decodeJson(parts[0]);
        const body = decodeJson(parts[1]);
        if (!head || !body || head.alg !== "EdDSA" || typeof head.kid !== "string")
            return null;
        const key = await keyFor(head.kid);
        if (!key)
            return null;
        const sig = Buffer.from(parts[2] ?? "", "base64url");
        if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, sig))
            return null;
        if (!isPayload(body) || body.iss !== ISSUER || body.aud !== audience)
            return null;
        return body.exp > Math.floor(now() / 1000) ? body : null;
    }
    return { verifyToken };
}
