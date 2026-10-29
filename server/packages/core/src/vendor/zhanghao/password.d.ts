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
import type { PasswordHasher } from "./ports.ts";
export declare const DEFAULT_PASSWORD_MIN_LENGTH = 6;
export declare const DEFAULT_PASSWORD_MAX_LENGTH = 128;
export interface PasswordLengthPolicy {
    minLength?: number;
    maxLength?: number;
}
/**
 * 说清楚为什么不行 —— 返回中文理由,合法返回 null。
 * 给人看的一句话,前端直接显示(旧实现返回错误码让前端自己拼文案,四个表单拼出四种说法)。
 */
export declare function explainPassword(password: unknown, policy?: PasswordLengthPolicy): string | null;
/** 同上,不合法直接抛 VALIDATION(message 就是那句中文理由) */
export declare function assertPassword(password: unknown, policy?: PasswordLengthPolicy): asserts password is string;
export interface ScryptOptions {
    /** CPU/内存代价,必须是 2 的幂(默认 16384 ≈ 16MB,单次约 50~80ms) */
    N?: number;
    r?: number;
    p?: number;
    keyLen?: number;
    saltLen?: number;
}
/**
 * 默认 PasswordHasher。格式:`scrypt$N$r$p$salt$hash`(salt/hash 均 base64url)。
 * 参数进哈希串是刻意的 —— 不然调参数那一刻,全库老密码集体验不过。
 */
export declare function createScryptHasher(options?: ScryptOptions): Required<Pick<PasswordHasher, "hash" | "verify" | "owns">>;