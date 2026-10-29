/**
 * 零依赖 HS256 JWT 签发与验签(node:crypto)。
 *
 * 为什么不用 jsonwebtoken:本包承诺零运行时依赖,而我们只需要 HS256 这一条路径;
 * 整个实现不到 100 行,且能把「密钥轮换」做成一等入参 —— 验签依次试 [current, ...previous],
 * 这样换密钥时**在途的 token 不会集体失效**(否则换一次密钥 = 全站被登出)。
 *
 * 三条纪律:
 *   - 只接受 alg=HS256:不认 header 里写的别的算法,更不认 alg=none(经典绕过)。
 *   - 签名比较走 timingSafeEqual。
 *   - 过期与非法是**两个**错误码:客户端据此决定「去续签」还是「回登录页」。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ZhanghaoError } from "./types.js";
function b64uEncode(input) {
    return Buffer.from(input).toString("base64url");
}
function b64uDecode(input) {
    return Buffer.from(input, "base64url");
}
function sign(data, secret) {
    return createHmac("sha256", secret).update(data).digest();
}
const HEADER = b64uEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
/** 签发。payload 里的 iat/exp 由本函数写,调用方传的同名字段会被覆盖 */
export function signJwt(payload, secret, options = {}) {
    const nowSec = Math.floor((options.now?.getTime() ?? Date.now()) / 1000);
    const full = { ...payload, iat: nowSec };
    if (options.expSec !== undefined)
        full.exp = nowSec + options.expSec;
    const body = b64uEncode(JSON.stringify(full));
    const data = `${HEADER}.${body}`;
    return `${data}.${sign(data, secret).toString("base64url")}`;
}
/**
 * 验签 + 验过期。secrets 传数组时依次试(轮换期);全部不匹配才判非法。
 * 注意顺序:**先验签名再看 exp** —— 一张伪造的过期 token 应该报「非法」而不是「过期」。
 */
export function verifyJwt(token, secrets, options = {}) {
    const list = (Array.isArray(secrets) ? secrets : [secrets]).filter((s) => typeof s === "string" && s.length > 0);
    if (list.length === 0)
        throw new ZhanghaoError("TOKEN_INVALID", "未配置签名密钥");
    const parts = String(token ?? "").split(".");
    if (parts.length !== 3)
        throw new ZhanghaoError("TOKEN_INVALID", "凭证格式不正确");
    const [head, body, sig] = parts;
    /* 头段**解析后**只认 alg=HS256(typ 可省略):RFC 7519 里 typ 是可选的,
       jose 等库默认只写 {"alg":"HS256"}。早期实现拿整段头做字节相等,会把别的库签的、
       完全合法的 HS256 token 全判成非法 —— 宿主迁移时存量 refresh 一张都续不了(5ffcg 真机抓到)。
       alg=none / RS256 等仍在这里被拒。 */
    let header;
    try {
        header = JSON.parse(b64uDecode(head).toString("utf8"));
    }
    catch {
        throw new ZhanghaoError("TOKEN_INVALID", "凭证格式不正确");
    }
    if (header.alg !== "HS256" || (header.typ !== undefined && header.typ !== "JWT")) {
        throw new ZhanghaoError("TOKEN_INVALID", "凭证格式不正确");
    }
    const data = `${head}.${body}`;
    let given;
    try {
        given = b64uDecode(sig);
    }
    catch {
        throw new ZhanghaoError("TOKEN_INVALID", "凭证格式不正确");
    }
    const matched = list.some((secret) => {
        const expect = sign(data, secret);
        return given.length === expect.length && timingSafeEqual(given, expect);
    });
    if (!matched)
        throw new ZhanghaoError("TOKEN_INVALID", "凭证无效");
    let payload;
    try {
        payload = JSON.parse(b64uDecode(body).toString("utf8"));
    }
    catch {
        throw new ZhanghaoError("TOKEN_INVALID", "凭证格式不正确");
    }
    if (payload === null || typeof payload !== "object")
        throw new ZhanghaoError("TOKEN_INVALID", "凭证格式不正确");
    const nowSec = Math.floor((options.now?.getTime() ?? Date.now()) / 1000);
    const tolerance = options.clockToleranceSec ?? 0;
    if (typeof payload.exp === "number" && nowSec > payload.exp + tolerance) {
        throw new ZhanghaoError("TOKEN_EXPIRED", "凭证已过期");
    }
    return payload;
}
/** 不验签只读载荷 —— 只给日志/调试用,**任何鉴权判断都不许用它** */
export function decodeJwtUnsafe(token) {
    const parts = String(token ?? "").split(".");
    if (parts.length !== 3)
        return null;
    try {
        return JSON.parse(b64uDecode(parts[1]).toString("utf8"));
    }
    catch {
        return null;
    }
}
