/**
 * 密码策略与默认哈希实现。
 *
 * 铁律(业主 2026-09-15 拍板,反向棘轮钉在 test/password.test.ts):
 *   **只判长度,默认 6–128。不做弱口令字典 / 字符种类 / 含用户名 / 键盘连排检查,也不许加回来。**
 *   `123456` 必须通过 —— 玩家记不住的密码会被写在便签上,那比弱口令更危险;
 *   真正挡爆破的是登录防护(LoginGuard 递进锁定)与单设备登录,不是注册时的字符种类要求。
 *
 * 哈希用 node:crypto scrypt:零依赖、内存硬、Node 自带。格式自带参数,
 * 所以将来调 N/r/p 或换 argon2 时老哈希照样能验(owns() 为假就验完重哈希)。
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { ZhanghaoError } from "./types.js";
export const DEFAULT_PASSWORD_MIN_LENGTH = 6;
export const DEFAULT_PASSWORD_MAX_LENGTH = 128;
/**
 * 说清楚为什么不行 —— 返回中文理由,合法返回 null。
 * 给人看的一句话,前端直接显示(旧实现返回错误码让前端自己拼文案,四个表单拼出四种说法)。
 */
export function explainPassword(password, policy = {}) {
    const min = policy.minLength ?? DEFAULT_PASSWORD_MIN_LENGTH;
    const max = policy.maxLength ?? DEFAULT_PASSWORD_MAX_LENGTH;
    if (typeof password !== "string")
        return "密码必须是文本";
    // 按码元长度判:表情等代理对算两位,但唯一目的是挡住存储与暴力面,不必按字形计数
    if (password.length < min)
        return `密码至少 ${min} 位`;
    if (password.length > max)
        return `密码最多 ${max} 位`;
    return null;
}
/** 同上,不合法直接抛 VALIDATION(message 就是那句中文理由) */
export function assertPassword(password, policy = {}) {
    const why = explainPassword(password, policy);
    if (why)
        throw new ZhanghaoError("VALIDATION", why);
}
const PREFIX = "scrypt";
function b64u(buf) {
    return buf.toString("base64url");
}
function scryptAsync(password, salt, keyLen, opts) {
    return new Promise((resolve, reject) => {
        // maxmem 要跟着 N/r 给足,否则 N 调大后直接报 "Invalid scrypt params"
        const maxmem = 256 * opts.N * opts.r * 2;
        scrypt(password, salt, keyLen, { ...opts, maxmem }, (err, key) => (err ? reject(err) : resolve(key)));
    });
}
/**
 * 默认 PasswordHasher。格式:`scrypt$N$r$p$salt$hash`(salt/hash 均 base64url)。
 * 参数进哈希串是刻意的 —— 不然调参数那一刻,全库老密码集体验不过。
 */
export function createScryptHasher(options = {}) {
    const N = options.N ?? 16384;
    const r = options.r ?? 8;
    const p = options.p ?? 1;
    const keyLen = options.keyLen ?? 32;
    const saltLen = options.saltLen ?? 16;
    return {
        async hash(password) {
            const salt = randomBytes(saltLen);
            const key = await scryptAsync(password, salt, keyLen, { N, r, p });
            return [PREFIX, N, r, p, b64u(salt), b64u(key)].join("$");
        },
        async verify(password, hash) {
            const parts = String(hash ?? "").split("$");
            if (parts.length !== 6 || parts[0] !== PREFIX)
                return false;
            const n = Number(parts[1]);
            const rr = Number(parts[2]);
            const pp = Number(parts[3]);
            if (!Number.isInteger(n) || !Number.isInteger(rr) || !Number.isInteger(pp))
                return false;
            let salt;
            let expect;
            try {
                salt = Buffer.from(parts[4], "base64url");
                expect = Buffer.from(parts[5], "base64url");
            }
            catch {
                return false;
            }
            if (expect.length === 0)
                return false;
            let got;
            try {
                got = await scryptAsync(password, salt, expect.length, { N: n, r: rr, p: pp });
            }
            catch {
                return false;
            }
            // 长度已相等(按 expect.length 派生),可以直接常量时间比
            return timingSafeEqual(got, expect);
        },
        /** 不是本实现产出的格式 → service 验过之后透明重哈希,不打扰玩家 */
        owns(hash) {
            const parts = String(hash ?? "").split("$");
            return parts.length === 6 && parts[0] === PREFIX;
        },
    };
}
