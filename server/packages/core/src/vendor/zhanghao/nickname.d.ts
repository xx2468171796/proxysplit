/**
 * 昵称规范 —— 服务端判定与前端提交前预检**同一个函数**,零依赖(浏览器 / Node 都能 import)。
 *
 * 业主 2026-10-01 拍板、所有站点适用:昵称不许带「死」「妈」「爸爸」这类字眼,以及谐音 / 拼音缩写骂人。
 * 不合规一律只回一句 NICKNAME_REJECT_MESSAGE —— **不告诉命中了哪个词**,免得玩家逐字试探绕过。
 *
 * `createZhanghao` 默认就开(`config.nickname`),register / updateProfile / admin.setNickname 三处都判;
 * 宿主自己的昵称写入口(不走 zh 的)必须调 `explainNickname`,传与 `config.nickname` **同一个常量**。
 * 存量不合规昵称的清理见 `zhanghao/nickname-sweep`。
 *
 * 加词:改下面两张表 → 跑 `test/nickname.test.ts` → 发版 → 各站升级;各站的清理任务下一拍自动处理新命中的存量。
 * 站点特有的词用规则里的 `extraWords` / `extraAbbreviations`,别 fork 词表。
 */
export declare const NICKNAME_REJECT_MESSAGE = "\u60A8\u7684\u6635\u79F0\u4E0D\u7B26\u5408\u89C4\u8303,\u8BF7\u91CD\u65B0\u8F93\u5165";
/** 子串命中即拒(比对前已做全角转半角、转小写、繁转简、去空白标点符号)。 */
export declare const BANNED_NICKNAME_WORDS: readonly string[];
/**
 * 放行的固定说法:比对前先从文本里抠掉(业主 2026-10-01「牛逼」是夸人,不算骂人)。
 * 只抠这个词本身 ——「傻逼」「你妈牛逼」照样命中(剩下的部分还会被判)。
 */
export declare const ALLOWED_NICKNAME_PHRASES: readonly string[];
export declare const BANNED_NICKNAME_HOMOPHONES: readonly string[];
/** 短字母缩写(2~4 个字母):前后都不是字母时才算(「全是sb」「我cnm」命中,「cjblat」不命中)。 */
export declare const BANNED_NICKNAME_ABBREVIATIONS: readonly string[];
/** 文本里有没有手机号(全角数字也算) */
export declare function containsPhoneNumber(value: unknown): boolean;
/** 把文本里的手机号打成 138****0000;没有手机号原样返回(NFKC 之后) */
export declare function maskPhonesInText(value: unknown): string;
/**
 * 注册时的默认昵称:宿主「没填昵称就用用户名」时用它,别直接用用户名 —— 用户名是手机号就打码。
 * (`zh.register` 自己也会把昵称里的手机号打码,这里是给宿主预检 / 判重用的同一口径)
 */
export declare function defaultNicknameFor(username: unknown): string;
export interface NicknameRule {
    /** 最短字符数;不传不判(各站长度规则不同,宿主自己定) */
    minLength?: number;
    /** 最长字符数;不传不判 */
    maxLength?: number;
    /** 站点追加的禁词(子串命中) */
    extraWords?: readonly string[];
    /** 站点追加的字母缩写(按字母边界判) */
    extraAbbreviations?: readonly string[];
    messages?: Partial<NicknameMessages>;
}
export interface NicknameMessages {
    tooShort: (min: number) => string;
    tooLong: (max: number) => string;
    offensive: string;
    phone: string;
}
export declare const DEFAULT_NICKNAME_MESSAGES: NicknameMessages;
/** 比对用的形态:全角转半角、转小写、繁转简(先于去符号,表情才换得到)、去掉空白 / 标点 / 符号 / 零宽字符。 */
export declare function nicknameScanForm(value: unknown): string;
export declare function nicknameIsOffensive(value: unknown, rule?: NicknameRule): boolean;
/**
 * 返回拒绝原因(中文,可直接给玩家看),合规返回 null。空昵称返回 null(空 = 没设昵称,显示时派生「玩家{id}」)。
 * 含手机号(自己的也不行,昵称是给全站看的)回「昵称不能包含手机号」。
 * 长度按去首尾空白、NFKC 之后的字符数(码点)算。
 */
export declare function explainNickname(value: unknown, rule?: NicknameRule): string | null;