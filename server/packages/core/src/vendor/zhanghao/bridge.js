/**
 * 与兄弟包联动的桥:把 zhanghao 已有的三条能力,按 tuiguang / liaotian / huiyuan
 * 要求宿主实现的「用户身份回调」形状摆好,宿主一行接上。
 *
 * ## 为什么桥在 zhanghao 这一侧,而不是让 tuiguang / liaotian / huiyuan 依赖 zhanghao
 *
 * 那三个包的设计前提是**零依赖、可单独接**:一个没有 zhanghao(自带账号体系)的宿主照样
 * 能接推广 / 聊天 / 会员,只要自己实现 `projectUsers` / `userExists` / `lookupUser` 三个回调。
 * 让它们 import zhanghao 就把这条前提砍了,而且会把「账号包升级」变成三个包的联动发版。
 * 反过来,zhanghao 本来就已经有 `publicUsers` / `publicUser` / `admin.search`,
 * 桥只是**不新增任何查询**地把它们按回调形状包一层 —— 现状是四个宿主各写三份 SQL,
 * 每份都得自己记住「公开投影不能带用户名」「hint 不能带完整手机号」这两条红线。
 *
 * 本文件零依赖(只 import 类型与掩码函数),不依赖三个兄弟包的类型:
 * 形状按它们的 INTEGRATION 手抄并由 `test/bridge.test.ts` 钉住,任何一边改形状先红这里。
 *
 * ## 三条不要改掉的语义
 *
 * 1. `projectUsers` **每个请求的 id 都有值**。tuiguang 的 `avatarKey` 是必填可空,
 *    map 里缺一个 id 它就会在渲染邀请列表时拿到 undefined;查不到的用 `fallbackDisplayName`
 *    兜底(与 zhanghao 配置的同一个函数,默认 `玩家{userId}`)。
 * 2. `userExists` **非法 id 不抛**。回调是从外部输入(邀请码 / @ 提及)一路传下来的,
 *    抛错会把兄弟包的整条请求打成 500,而正确答案就是「不存在」。
 * 3. `lookupUser` 的 `hint` **只放脱敏信息**:用户名(它本来就是给后台看的检索键)、
 *    掩码手机号、注册日期。完整手机号 / 邮箱 / 封禁原因一律不进 hint —— huiyuan 会把候选
 *    列表原样回给后台页面,页面那头不再有第二道脱敏。
 */
import { maskPhone } from "./identifier.js";
import { maskPhonesInText } from "./nickname.js";
const DEFAULT_LOOKUP_LIMIT = 10;
const defaultFallback = (id) => `玩家${id}`;
/** 形如 20260915 的注册日期(hint 里只给到「天」,不给时分秒,足够运营对人) */
function dayOf(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
export function createIdentityBridge(zh, opts = {}) {
    const fallback = opts.fallbackDisplayName ?? defaultFallback;
    const limit = Math.max(1, Math.floor(opts.lookupLimit ?? DEFAULT_LOOKUP_LIMIT));
    return {
        async projectUsers(userIds) {
            const ids = [...new Set(userIds.map((s) => String(s ?? "").trim()).filter((s) => s.length > 0))];
            const out = new Map();
            if (ids.length === 0)
                return out;
            // publicUsers 只回查得到的那部分,缺的在这里补 —— 兄弟包对「map 里没这个 key」不做防御
            let found;
            try {
                found = await zh.publicUsers(ids);
            }
            catch {
                found = new Map();
            }
            for (const id of ids) {
                out.set(id, found.get(id) ?? { userId: id, displayName: fallback(id), avatarKey: null });
            }
            return out;
        },
        async userExists(userId) {
            const id = String(userId ?? "").trim();
            if (!id)
                return false;
            try {
                return (await zh.publicUser(id)) !== null;
            }
            catch {
                // 非法 id(非数字串、超 int8)在 PG store 上会抛;答案就是「不存在」
                return false;
            }
        },
        async lookupUser(q) {
            const query = String(q ?? "").trim();
            if (!query)
                return [];
            const rows = await zh.admin.search({ query, limit });
            return rows.slice(0, limit).map((u) => {
                // 用户名常就是手机号:标签与提示里一律打码(运营截图外泄是真事)
                const label = maskPhonesInText(u.nickname?.trim() || u.username);
                const hint = [maskPhonesInText(u.username), maskPhone(u.phone), dayOf(u.createdAt)].filter((s) => !!s).join(" · ");
                return { siteUserId: u.userId, label, hint };
            });
        },
    };
}
