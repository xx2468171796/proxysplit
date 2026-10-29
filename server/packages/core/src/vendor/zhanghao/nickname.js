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
export const NICKNAME_REJECT_MESSAGE = "您的昵称不符合规范,请重新输入";
/** 子串命中即拒(比对前已做全角转半角、转小写、繁转简、去空白标点符号)。 */
export const BANNED_NICKNAME_WORDS = [
    // 业主点名
    "死", "妈", "爸", "爹",
    // 「妈」的谐音
    "尼玛", "泥马", "你马", "你吗", "草泥马", "曹尼玛", "玛的", "马的", "他喵", "特么", "特喵",
    // 辱骂 / 粗口
    "操", "肏", "艹", "卧槽", "我草", "握草", "草你", "日你", "日了狗",
    "傻逼", "傻b", "傻比", "傻笔", "煞笔", "煞逼", "煞b", "沙比", "沙笔", "傻狗", "逼",
    "鸡巴", "鸡儿", "鸡鸡", "屌", "婊", "贱人", "贱货", "妓", "母狗", "狗日", "狗娘", "狗东西",
    "射你", "跳蛋", "内射", "约炮", "做爱",
    "杂种", "野种", "畜生", "畜牲", "王八蛋", "龟孙", "你爷爷", "你老子", "滚蛋", "废物", "智障", "脑残", "弱智", "白痴",
    // 长拼音 / 英文(子串足够长,不会误伤)
    "nmsl", "nmlgb", "mlgb", "wcnm", "caonima", "nimabi", "shabi", "fuck", "shit", "bitch", "asshole",
    // 1.14.0 业主:「男娘」及近义词、谐音一律不许(5eplay「我是男娘洛溪瑶」「极品男娘洛曦瑶」)。
    // 生产六站预演只命中这 4 个号;单独的「cd」不拦(误伤「CDDI」),「女孩子」不拦(太宽)
    // 男娘 / 伪娘 / 药娘 / 女装 / 人妖 / 扶她 的谐音见下面 CROSSDRESS_HOMOPHONES(1.15.0 两两组合)
    "变装癖", "伪男",
    "femboy", "crossdress", "ladyboy", "shemale", "sissy", "futanari",
];
/**
 * 放行的固定说法:比对前先从文本里抠掉(业主 2026-10-01「牛逼」是夸人,不算骂人)。
 * 只抠这个词本身 ——「傻逼」「你妈牛逼」照样命中(剩下的部分还会被判)。
 */
export const ALLOWED_NICKNAME_PHRASES = ["牛逼"];
/**
 * 谐音组合(1.12.0,业主:「s、4 这种都是谐音」)。5eplay 玩家被改名后立刻改成「黄鹤楼s母了」绕过「死妈」。
 * 「死」的谐音 × 「妈」的谐音 / 「全家」两两组合全拦;**单独的 s / 4 不拦**(「4S店」「s1mple」)。
 * 纯字母的组合(sma / sima / smom)走缩写的字母边界判,免得「small」「simon」误伤。
 */
const DEATH_HOMOPHONES = ["s", "si", "4"];
const MOTHER_HOMOPHONES = ["妈", "母", "马", "码", "吗", "嘛", "麻", "ma", "mom", "全家"];
const isLatin = (w) => /^[a-z]+$/.test(w);
const pairs = (a, b) => a.flatMap((x) => b.map((y) => x + y));
const HOMOPHONE_COMBOS = pairs(DEATH_HOMOPHONES, MOTHER_HOMOPHONES);
/**
 * 「男娘」类谐音(1.15.0,业主:「谐音也要注意」)。前字谐音 × 后字谐音两两全拦,中文、拼音可以混写(「南niang」「nan酿」)。
 * 「田力」= 男 拆字;繁体 / ♂ 在 VARIANTS 里先归一。纯拼音组合 ≥ 6 个字母按子串判(nanniang / nvzhuang),
 * 更短的(futa)走字母边界。生产六站预演见 docs/memory/zhanghao.md。
 */
const NIANG = ["娘", "酿", "niang"];
const CROSSDRESS_HOMOPHONES = [
    ...pairs(["男", "南", "楠", "难", "喃", "腩", "田力", "nan"], NIANG),
    ...pairs(["伪", "尾", "委", "喂", "为", "维", "卫", "未", "唯", "萎", "wei"], NIANG),
    ...pairs(["药", "妖", "yao"], NIANG),
    ...pairs(["女", "钕", "nv", "nu"], ["装", "妆", "zhuang"]),
    ...pairs(["人", "ren"], ["妖", "yao"]),
    ...pairs(["扶", "fu"], ["她", "他", "ta"]),
];
const isShortLatin = (w) => isLatin(w) && w.length < 6;
export const BANNED_NICKNAME_HOMOPHONES = [
    ...HOMOPHONE_COMBOS.filter((w) => !isLatin(w)),
    ...CROSSDRESS_HOMOPHONES.filter((w) => !isShortLatin(w)),
];
/** 短字母缩写(2~4 个字母):前后都不是字母时才算(「全是sb」「我cnm」命中,「cjblat」不命中)。 */
export const BANNED_NICKNAME_ABBREVIATIONS = [
    "sb", "jb", "nm", "cnm", "nmb", "rnm", "tmd", "nmd", "nnd", "qnmd",
    ...HOMOPHONE_COMBOS.filter(isLatin),
    ...CROSSDRESS_HOMOPHONES.filter(isShortLatin),
];
/** 繁体 / 异体 / 表情 → 简体(只收词表里用得到的字;「🐔🐔」= 鸡鸡) */
const VARIANTS = {
    "🐔": "鸡", 媽: "妈", 爺: "爷", 雞: "鸡", 賤: "贱", 種: "种", 龜: "龟", 孫: "孙", 廢: "废", 腦: "脑", 殘: "残", 癡: "痴", 馬: "马", 瑪: "玛",
    偽: "伪", 藥: "药", 裝: "装", 孃: "娘", 嬢: "娘", 釀: "酿", 變: "变",
    "♂": "男", 難: "难", 為: "为", 維: "维", 衛: "卫", 釹: "钕", 妝: "妆",
};
/**
 * 手机号不许出现在任何给别人看的名字里(业主 2026-10-01:「不要泄露他的手机号,中间 4 位打上星星」)。
 * 多数站注册时昵称默认 = 用户名,而用户名常常就是手机号 —— 5eplay 上线时全站一半昵称是完整手机号。
 * 认:可选 +86 / 86 前缀、中间允许空格或横杠的 1[3-9] 开头 11 位;前后紧挨数字的不算(订单号之类)。
 */
const PHONE_IN_TEXT = /(?<!\d)(?:\+?86[\s-]?)?(1[3-9]\d)[\s-]?(\d{4})[\s-]?(\d{4})(?!\d)/g;
/** 文本里有没有手机号(全角数字也算) */
export function containsPhoneNumber(value) {
    return new RegExp(PHONE_IN_TEXT.source).test(String(value ?? "").normalize("NFKC"));
}
/** 把文本里的手机号打成 138****0000;没有手机号原样返回(NFKC 之后) */
export function maskPhonesInText(value) {
    return String(value ?? "").normalize("NFKC").replace(PHONE_IN_TEXT, (_m, a, _b, c) => `${a}****${c}`);
}
/**
 * 注册时的默认昵称:宿主「没填昵称就用用户名」时用它,别直接用用户名 —— 用户名是手机号就打码。
 * (`zh.register` 自己也会把昵称里的手机号打码,这里是给宿主预检 / 判重用的同一口径)
 */
export function defaultNicknameFor(username) {
    return maskPhonesInText(String(username ?? "").trim());
}
export const DEFAULT_NICKNAME_MESSAGES = {
    tooShort: (min) => `昵称至少 ${min} 个字符`,
    tooLong: (max) => `昵称最多 ${max} 个字符`,
    offensive: NICKNAME_REJECT_MESSAGE,
    phone: "昵称不能包含手机号",
};
/** 比对用的形态:全角转半角、转小写、繁转简(先于去符号,表情才换得到)、去掉空白 / 标点 / 符号 / 零宽字符。 */
export function nicknameScanForm(value) {
    return String(value ?? "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/./gu, (ch) => VARIANTS[ch] ?? ch)
        .replace(/[\p{Z}\p{P}\p{S}\p{Cc}\p{Cf}]/gu, "");
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const abbreviationRe = (list) => new RegExp(`(?<![a-z])(?:${list.map((w) => escapeRe(nicknameScanForm(w))).join("|")})(?![a-z])`);
const DEFAULT_WORDS = [...BANNED_NICKNAME_WORDS, ...BANNED_NICKNAME_HOMOPHONES].map(nicknameScanForm);
const DEFAULT_ABBR_RE = abbreviationRe(BANNED_NICKNAME_ABBREVIATIONS);
/** 昵称是否含违规字眼(不管长度)。 */
const ALLOWED_SCAN = ALLOWED_NICKNAME_PHRASES.map(nicknameScanForm);
export function nicknameIsOffensive(value, rule = {}) {
    // 放行词替换成分隔符(不是删掉):删掉会让两侧拼出新词,「傻牛逼逼」删成「傻逼」反而误判,而分隔后各自再判
    const scan = ALLOWED_SCAN.reduce((acc, w) => acc.split(w).join("|"), nicknameScanForm(value));
    if (!scan)
        return false;
    const words = rule.extraWords?.length ? [...DEFAULT_WORDS, ...rule.extraWords.map(nicknameScanForm)] : DEFAULT_WORDS;
    if (words.some((w) => w && scan.includes(w)))
        return true;
    const abbr = rule.extraAbbreviations?.length ? abbreviationRe([...BANNED_NICKNAME_ABBREVIATIONS, ...rule.extraAbbreviations]) : DEFAULT_ABBR_RE;
    // 缩写原样查一次,再把连写重复字母(「jbbbb」「sbbb」)收拢后查一次 —— 只查收拢的会漏掉「nnd」本身
    return abbr.test(scan) || abbr.test(scan.replace(/([a-z])\1+/g, "$1"));
}
/**
 * 返回拒绝原因(中文,可直接给玩家看),合规返回 null。空昵称返回 null(空 = 没设昵称,显示时派生「玩家{id}」)。
 * 含手机号(自己的也不行,昵称是给全站看的)回「昵称不能包含手机号」。
 * 长度按去首尾空白、NFKC 之后的字符数(码点)算。
 */
export function explainNickname(value, rule = {}) {
    const nick = String(value ?? "").normalize("NFKC").trim();
    if (!nick)
        return null;
    const m = { ...DEFAULT_NICKNAME_MESSAGES, ...rule.messages };
    const len = [...nick].length;
    if (rule.minLength !== undefined && len < rule.minLength)
        return m.tooShort(rule.minLength);
    if (rule.maxLength !== undefined && len > rule.maxLength)
        return m.tooLong(rule.maxLength);
    if (nicknameIsOffensive(nick, rule))
        return m.offensive;
    if (containsPhoneNumber(nick))
        return m.phone;
    return null;
}
