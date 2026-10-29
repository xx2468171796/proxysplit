/**
 * 用户名规则 —— 服务端判定与前端提交前预检**同一个函数**,文案全部中文。
 *
 * 2026-09-16 6E 注册页真机出现过「username: String must contain at least 3 character(s)」:
 * 前端只预检密码不预检用户名,服务端校验库的英文原文直接吐给玩家。规则与文案只准有一份,
 * 所以放在这里(零依赖,浏览器/Node 都能 import),`service.ts` 与 `react/logic.ts` 都从这取。
 *
 * 默认:3–32 位,只含字母 / 数字 / 下划线;纯数字默认拒(生产上真出现过 34 个登录名就是手机号形状,
 * 登录框永远分不清它是账号还是号码),宿主允许纯数字就传 `allowAllDigits: true`。
 * 宿主若传了自定义 `pattern`,细分理由无从得知,只能给 `badPattern` 一句。
 *
 * 1.9.0 起宿主规则能写成「长度 + 字符集 + 禁用字符」三件事(`charset` / `forbiddenChars`),
 * 每条不合法都有一句具体的中文理由 —— 以前 5FF 那种「2–20 位、不含空白、允许中文」只能写成 pattern,
 * 于是所有错误都退化成「用户名格式不正确」,前端预检也就只能各站自己再写一份文案(规则就此分叉)。
 * `forbiddenChars` 只影响**新注册 / 改用户名**:登录照旧按库里的原值查,老账号不受影响
 * (5FF 生产 87 个登录名形如「xxx@qq.com」,2026-09-23 业主拍板「以后禁止 @」而老号照常能登)。
 */
export declare const DEFAULT_USERNAME_MIN_LENGTH = 3;
export declare const DEFAULT_USERNAME_MAX_LENGTH = 32;
export declare const DEFAULT_USERNAME_CHARSET: RegExp;
export declare const DEFAULT_USERNAME_PATTERN: RegExp;
export interface UsernameRule {
    /** 自定义整体正则(传了就只按它判,理由只能是 badPattern) */
    pattern?: RegExp;
    minLength?: number;
    maxLength?: number;
    /** 整串必须匹配的字符集(默认 /^[a-zA-Z0-9_]+$/);例如「不含空白、允许中文」= /^\S+$/。传了 pattern 时不看它 */
    charset?: RegExp;
    /**
     * 禁止出现的字符(逐个判,命中给「用户名不能包含「x」」)。与 pattern / charset 叠加生效。
     * 典型:`["@"]` —— 用户名里有 @ 会与邮箱登录混淆(登录框一个输入框收用户名 / 手机号 / 邮箱)。
     */
    forbiddenChars?: readonly string[];
    allowAllDigits?: boolean;
    /** 文案覆盖(全部可选,默认中文) */
    messages?: Partial<UsernameMessages>;
}
export interface UsernameMessages {
    empty: string;
    tooShort: (min: number) => string;
    tooLong: (max: number) => string;
    badCharset: string;
    badPattern: string;
    allDigits: string;
    forbiddenChar: (ch: string) => string;
}
export declare const DEFAULT_USERNAME_MESSAGES: UsernameMessages;
export declare const DEFAULT_USERNAME_HINT = "3\u201332 \u4F4D,\u53EA\u80FD\u5305\u542B\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u4E0B\u5212\u7EBF";
/** 归一化:trim;不改大小写(唯一性由 store 的 lower(username) 索引裁决) */
export declare function normalizeUsername(raw: unknown): string;
/**
 * 不合法返回一句人话,合法返回 null。服务端与前端共用。
 * 判定顺序:空 → 长度(无 pattern 时)→ 禁用字符 → pattern / 字符集 → 纯数字。
 * 禁用字符排在字符集之前:「a@b」在默认字符集下两条都不过,给更具体的那句。
 */
export declare function explainUsername(raw: unknown, rule?: UsernameRule): string | null;