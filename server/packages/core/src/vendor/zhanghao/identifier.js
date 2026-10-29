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
import { maskPhonesInText } from "./nickname.js";
/** PG int8 上界:超出它的纯数字串当不成 userId(拿去查会把列表页打成 500) */
const INT8_MAX = 9223372036854775807n;
/**
 * 手机号归一化:全角转半角,去空格/横杠/括号/点,剥 + / 00 与 86 国际前缀,只留数字。
 * **与 yanzheng/sms 的 normalizePhone 同规则**(1.8.2 对齐):各站写入手机号多数走那一个,
 * 登录查询走这一个 —— 两边不一致时玩家输「8613800000000」或全角数字就登不进,只报密码错。
 * 空串/只剩空白 → null(「没有手机号」与「空字符串」在唯一索引上是两回事)。
 */
export function normalizePhone(raw) {
    if (raw == null)
        return null;
    // NFKC:全角数字 / 全角括号 → 半角(手机输入法常见)
    let s = String(raw).trim().normalize("NFKC");
    if (!s)
        return null;
    s = s.replace(/[\s\-().]/g, "");
    if (s.startsWith("+"))
        s = s.slice(1);
    else if (s.startsWith("00"))
        s = s.slice(2); // 00 是国际前缀的另一种写法
    if (s.startsWith("86") && s.length > 11)
        s = s.slice(2); // 86 + 11 位
    s = s.replace(/\D/g, "");
    return s ? s : null;
}
/** 邮箱归一化:trim + 全小写(域名大小写不敏感,本地部分虽理论敏感但没人真这么用) */
export function normalizeEmail(raw) {
    if (raw == null)
        return null;
    const s = String(raw).trim().toLowerCase();
    return s ? s : null;
}
/** 用户名归一化:只 trim。**刻意不转小写** —— 大小写是用户自己选的展示形态 */
export function normalizeUsername(raw) {
    if (raw == null)
        return null;
    const s = String(raw).trim();
    return s ? s : null;
}
/**
 * 登录框一个输入框,按形状判它是三者中的哪一个:
 *   含 @ → 邮箱;归一化后是 11 位且以 1 开头的纯数字 → 手机号;否则用户名。
 * 判不出手机号就退回用户名是有意的:本站允许纯数字用户名,判错方向只会「查不到」而不会串号。
 */
export function classifyIdentifier(raw) {
    const trimmed = String(raw ?? "").trim().normalize("NFKC");
    if (trimmed.includes("@"))
        return { kind: "email", value: normalizeEmail(trimmed) ?? "" };
    const phone = normalizePhone(trimmed);
    if (phone && /^1\d{10}$/.test(phone) && /^[\d\s+\-().]+$/.test(trimmed)) {
        return { kind: "phone", value: phone };
    }
    return { kind: "username", value: normalizeUsername(trimmed) ?? "" };
}
export function loginLookupOrder(raw, opts = {}) {
    const ident = classifyIdentifier(raw);
    const out = [];
    const username = normalizeUsername(raw);
    if (username)
        out.push({ kind: "username", value: username });
    if ((ident.kind === "phone" || ident.kind === "email") && ident.value)
        out.push(ident);
    // 昵称永远排最后(1.9.0,可选):它不唯一,也不是任何人主动选的登录名 —— 排在前面等于
    // 允许别人把昵称改成 A 的用户名 / 手机号来截胡。宿主不开这个选项,返回值与 1.8.x 逐字相同。
    if (opts.nickname) {
        const nick = normalizeNickname(raw);
        if (nick)
            out.push({ kind: "nickname", value: nick });
    }
    return out;
}
/** 昵称归一化:只 trim(大小写是否敏感由 store 决定;包自带的 store 都按 lower() 等值、不区分大小写) */
export function normalizeNickname(raw) {
    if (raw == null)
        return null;
    const s = String(raw).trim();
    return s ? s : null;
}
/**
 * 按昵称查登录账号时 store 最多取几条 —— 取 2 条就够判「是不是恰好一个」。
 * 宿主自己写查询时照这个数 limit,别整表拉。
 */
export const NICKNAME_LOGIN_CANDIDATE_LIMIT = 2;
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
export function pickUniqueNicknameMatch(rows) {
    return rows && rows.length === 1 ? rows[0] : null;
}
/** 138****0000:保留前 3 后 4,中间恒 4 颗星(不按真实长度出星,否则星数本身泄露位数) */
export function maskPhone(phone) {
    const p = normalizePhone(phone);
    if (!p)
        return null;
    if (p.length <= 7)
        return `${p.slice(0, 1)}****`;
    return `${p.slice(0, 3)}****${p.slice(-4)}`;
}
/** a***@example.com:本地部分只留首字符 */
export function maskEmail(email) {
    const e = normalizeEmail(email);
    if (!e)
        return null;
    const at = e.lastIndexOf("@");
    if (at <= 0)
        return `${e.slice(0, 1)}***`;
    const local = e.slice(0, at);
    const domain = e.slice(at);
    return `${local.slice(0, 1)}***${domain}`;
}
/** 昵称为空 → 派生名。玩家之间只看得到这个,所以它绝不能由 username 派生 */
export function displayNameOf(user, fallback = (id) => `玩家${id}`) {
    // 给别人看的名字里绝不出现完整手机号(1.11.0):存量昵称 / 宿主 fallback 里有手机号都打码
    const nick = user.nickname?.trim();
    return maskPhonesInText(nick ? nick : fallback(user.userId));
}
/**
 * 后台一个搜索框 → store 的结构化条件片段。
 * 纯数字**同时**按 userId 精确与手机号包含(运营手里可能是编号也可能是号码片段);
 * 超出 int8 的纯数字只给 phoneContains —— 拿它当 userId 去查会在数据库层炸。
 */
export function parseSearchQuery(q) {
    const raw = String(q ?? "").trim();
    if (!raw)
        return {};
    if (/^\d+$/.test(raw)) {
        const out = { phoneContains: raw };
        try {
            if (BigInt(raw) <= INT8_MAX)
                out.userId = raw;
        }
        catch {
            /* 解析不了就不给 userId */
        }
        return out;
    }
    // 运营常直接粘「138 0000 0000」这种带分隔符的号码:能归一化出纯数字就按号码片段查
    const phone = normalizePhone(raw);
    if (phone && /^[\d\s+\-().]+$/.test(raw))
        return { phoneContains: phone };
    return { textContains: raw };
}
