/**
 * 标识符归一化与识别 —— 手机号 / 邮箱 / 用户名。
 *
 * 为什么单独一个文件:**写入端与查询端必须是同一个函数**。生产里踩过的坑是运营复制
 * 「138 0000 0000」去后台查,而写入时存的是纯数字,于是永远「查无此人」而界面不报错。
 * 只要归一化散成两处,这类错就会静默复发。
 *
 * 掩码与公开昵称也放这里:PublicUser 结构上拿不到 username/phone,昵称为空时**读取时派生**
 * 「玩家{userId}」而不是写库 —— 写库等于把派生值冻在行上,以后改规则改不动历史。
 */
import type { UniqueField } from "./store/types.ts";
/**
 * 手机号归一化:全角转半角,去空格/横杠/括号/点,剥 + / 00 与 86 国际前缀,只留数字。
 * **与 yanzheng/sms 的 normalizePhone 同规则**(1.8.2 对齐):各站写入手机号多数走那一个,
 * 登录查询走这一个 —— 两边不一致时玩家输「8613800000000」或全角数字就登不进,只报密码错。
 * 空串/只剩空白 → null(「没有手机号」与「空字符串」在唯一索引上是两回事)。
 */
export declare function normalizePhone(raw: string | null | undefined): string | null;
/** 邮箱归一化:trim + 全小写(域名大小写不敏感,本地部分虽理论敏感但没人真这么用) */
export declare function normalizeEmail(raw: string | null | undefined): string | null;
/** 用户名归一化:只 trim。**刻意不转小写** —— 大小写是用户自己选的展示形态 */
export declare function normalizeUsername(raw: string | null | undefined): string | null;
/**
 * 登录框一个输入框,按形状判它是三者中的哪一个:
 *   含 @ → 邮箱;归一化后是 11 位且以 1 开头的纯数字 → 手机号;否则用户名。
 * 判不出手机号就退回用户名是有意的:本站允许纯数字用户名,判错方向只会「查不到」而不会串号。
 */
export declare function classifyIdentifier(raw: string): {
    kind: UniqueField;
    value: string;
};
/**
 * 登录框那一串**按什么顺序查**。与 classifyIdentifier 的区别:那个只给「最像什么」一个答案,
 * 登录不能只查一处 —— 老站允许纯数字用户名,生产上有成批账号的**登录名本身就长成手机号**
 * 而并没有绑手机。只按手机号查,这些人就再也登不进来,表现是「账号或密码不正确」,没有任何一处报错。
 *
 * 顺序:**永远先查用户名**;查不到时,含 @ → 再按邮箱查,形状是手机号 → 再按手机号查。
 * 用户名优先不可反:同一串同时是 A 的用户名与 B 的手机号(或邮箱)时,确定性地指向 A(B 用自己的用户名登);
 * 反过来的话,任何人把某串号码绑到自己号上,就能把「登录名恰好是这串」的老账号顶掉。
 * 含 @ 也先查用户名(1.8.1):老站允许用户名里带 @(5FF 生产 87 个号的登录名就是「xxx@qq.com」、
 * 邮箱列却是占位值),「含 @ 只查邮箱」会让这些人永远登不进且只提示密码错。
 * 用户名里不许出现 @ 的站点,这一步只是多一次查不到的查询,行为不变。
 * 手机号一支用与写入端**同一个** normalizePhone,玩家粘进来的「138 0000 0000」也能查中。
 * 1.9.0:传 `{ nickname: true }` 时在最后追加昵称一支(裁决见 pickUniqueNicknameMatch);不传与 1.8.x 逐字相同。
 */
export declare function loginLookupOrder(raw: string): Array<{
    kind: UniqueField;
    value: string;
}>;
export declare function loginLookupOrder(raw: string, opts: LoginLookupOptions): LoginLookupStep[];
/** 登录查找的一步:三个唯一标识之一,或(开了昵称登录时)昵称 */
export type LoginLookupKind = UniqueField | "nickname";
export interface LoginLookupStep {
    kind: LoginLookupKind;
    value: string;
}
export interface LoginLookupOptions {
    /** 在最后追加昵称一支(默认 false)。对应 createZhanghao 的 config.login.nickname */
    nickname?: boolean;
}
/** 昵称归一化:只 trim(大小写是否敏感由 store 决定;包自带的 store 都按 lower() 等值、不区分大小写) */
export declare function normalizeNickname(raw: string | null | undefined): string | null;
/**
 * 按昵称查登录账号时 store 最多取几条 —— 取 2 条就够判「是不是恰好一个」。
 * 宿主自己写查询时照这个数 limit,别整表拉。
 */
export declare const NICKNAME_LOGIN_CANDIDATE_LIMIT = 2;
/**
 * 昵称一支的裁决:**恰好一个账号叫这个昵称才命中,多于一个当查不到**(走「账号或密码不正确」那条统一出口)。
 *
 * 为什么不是「取最早注册的那个」或「挨个试密码」:
 *   - 昵称不唯一、谁都能改。「取最早注册」= 后来者把昵称改成和某老玩家一样,那个老玩家就可能登进别人的号
 *     (或者反过来被挤得登不进),而且谁都说不清为什么。
 *   - 「挨个试密码」= 一次登录对 N 个账号验密码,等于给撞库送了 N 倍命中率。
 *   - 「有重名就明说『该昵称有多个用户』」(5FF 1.9.0 前的做法)会告诉外人「这个昵称至少两个人在用」,
 *     响应与「查不到」不同就是枚举预言机;并入统一出口后,重名的人本来也登不进(以前同样拒),对玩家零损失。
 * 传进来的应是 store 按 NICKNAME_LOGIN_CANDIDATE_LIMIT 取回的行。
 */
export declare function pickUniqueNicknameMatch<T>(rows: readonly T[] | null | undefined): T | null;
/** 138****0000:保留前 3 后 4,中间恒 4 颗星(不按真实长度出星,否则星数本身泄露位数) */
export declare function maskPhone(phone: string | null | undefined): string | null;
/** a***@example.com:本地部分只留首字符 */
export declare function maskEmail(email: string | null | undefined): string | null;
/** 昵称为空 → 派生名。玩家之间只看得到这个,所以它绝不能由 username 派生 */
export declare function displayNameOf(user: {
    nickname?: string | null;
    userId: string;
}, fallback?: (userId: string) => string): string;
/**
 * 后台一个搜索框 → store 的结构化条件片段。
 * 纯数字**同时**按 userId 精确与手机号包含(运营手里可能是编号也可能是号码片段);
 * 超出 int8 的纯数字只给 phoneContains —— 拿它当 userId 去查会在数据库层炸。
 */
export declare function parseSearchQuery(q: string | null | undefined): {
    userId?: string;
    phoneContains?: string;
    textContains?: string;
};