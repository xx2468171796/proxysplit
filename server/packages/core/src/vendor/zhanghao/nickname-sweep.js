/**
 * 存量昵称清理:已经不符合昵称规范(`zhanghao/nickname`)的昵称,改成用户名并给玩家发一条站内信。
 *
 * 业主 2026-10-01:「已经不符合规范的,就把它的昵称改成用户名,然后发送个通知」。
 * 包只管**挑谁、改成什么、通知怎么写、先后顺序**;读用户、写昵称、发通知全部由宿主注入
 * (各站昵称列名 / 机器人判法 / 通知包接法都不一样)。宿主用自己的定时任务(dingshi)每天跑一次:
 * 词表加词发版后,下一拍自动处理新命中的存量,不用另写脚本。
 *
 * 几条写错了不报错的地方:
 *   1. **先通知、后改名**,通知带幂等键(用户 + 旧昵称)。反过来的话,改名成功而通知失败,
 *      下一拍已经扫不到这个人 → 玩家莫名其妙被改名、永远收不到解释。现在的顺序:通知成功改名失败
 *      → 下一拍再来,同一个幂等键不会发第二条。
 *   2. `rename` 必须是**条件更新**(`WHERE id=? AND nickname=<旧值>`):扫描到写入之间玩家自己改过就别覆盖。
 *   3. 用户名形如邮箱(含 @)不拿来当昵称:那等于把邮箱公示给全站;用户名是手机号的用打码形式(138****0000)。
 *   另:1.11.0 起昵称里含完整手机号(多是注册时默认昵称 = 手机号用户名)也清理:改成打码形式,**默认不发通知**
 *      (那不是玩家违规,是站点替他泄露了号码;发几百条「昵称已被重置」只会吓到人)。`notifyPhoneMask: true` 可开。
 *   4. 昵称在站内要求唯一时(多数站),替代名也要避开已占用的;占用判定与宿主判重同一口径(NFKC + 小写)。
 */
import { containsPhoneNumber, explainNickname, maskPhonesInText, nicknameIsOffensive } from "./nickname.js";
/** 判重口径:与各站 nicknameKey 一致(NFKC + 去首尾空白 + 小写) */
export function nicknameKey(value) {
    return String(value ?? "").normalize("NFKC").trim().toLowerCase();
}
export function defaultNicknameCandidates(user) {
    const out = [];
    const name = maskPhonesInText(String(user.username ?? "").trim());
    if (name && !name.includes("@"))
        out.push(name);
    out.push(`玩家${user.userId}`);
    for (let i = 2; i < 100; i++)
        out.push(`玩家${user.userId}_${i}`);
    return out;
}
/** 给违规昵称挑替代名;taken = 已占用的 nicknameKey 集合(unique=false 时传空集合) */
export function pickReplacementNickname(user, taken, opts = {}) {
    const list = (opts.candidates ?? defaultNicknameCandidates)(user);
    return list.find((c) => explainNickname(c, opts.rule) === null && !!c.trim() && !taken.has(nicknameKey(c))) ?? null;
}
/** FNV-1a 64 位(两路 32 位)—— 零依赖、浏览器可用,只做幂等键用,不是安全哈希 */
function shortHash(s) {
    let a = 0x811c9dc5;
    let b = 0x01000193 ^ 0x9e3779b9;
    for (const ch of s) {
        const c = ch.codePointAt(0) ?? 0;
        a = Math.imul(a ^ c, 0x01000193) >>> 0;
        b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    }
    return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
export function nicknameResetNotice(user, previous, next) {
    return {
        title: "昵称已被重置",
        body: `您的昵称「${previous}」不符合规范,已改为「${next}」。您可以到个人资料重新设置昵称。`,
        link: null,
        idemKey: `nickname-reset:${user.userId}:${shortHash(previous)}`,
    };
}
export async function sweepOffensiveNicknames(opts) {
    const users = await opts.listUsers();
    const unique = opts.unique !== false;
    const taken = new Set(unique ? users.filter((u) => u.nickname).map((u) => nicknameKey(u.nickname)) : []);
    const onError = opts.onError ?? ((u, e) => console.warn(`[zhanghao/nickname-sweep] 用户 ${u.userId} 处理失败:${e?.message ?? e}`));
    const result = { scanned: users.length, offending: 0, masked: 0, renamed: 0, failed: 0, changes: [] };
    for (const u of users) {
        const previous = u.nickname;
        // 只看字眼:长度不合规的老昵称不在清理范围里(规则改长度别顺手改掉一批人的名字)
        if (!previous)
            continue;
        const offensive = nicknameIsOffensive(previous, opts.rule);
        const phoneOnly = !offensive && containsPhoneNumber(previous);
        if (!offensive && !phoneOnly)
            continue;
        result.offending++;
        // 只含手机号:优先就地打码(「13800000000」→「138****0000」,「小王13800000000」→「小王138****0000」),玩家几乎无感
        const next = phoneOnly
            ? pickReplacementNickname(u, taken, { ...opts, candidates: (x) => [maskPhonesInText(previous), ...(opts.candidates ?? defaultNicknameCandidates)(x)] })
            : pickReplacementNickname(u, taken, opts);
        if (!next) {
            result.failed++;
            onError(u, new Error("找不到可用的替代昵称"));
            continue;
        }
        try {
            if (opts.notify && !u.isBot && (!phoneOnly || opts.notifyPhoneMask)) {
                const base = nicknameResetNotice(u, previous, next);
                const custom = opts.notice?.(u, previous, next);
                await opts.notify(u, custom ? { ...custom, idemKey: base.idemKey } : base);
            }
            if (!(await opts.rename(u, next, previous)))
                continue;
            if (unique) {
                taken.delete(nicknameKey(previous));
                taken.add(nicknameKey(next));
            }
            result.renamed++;
            if (phoneOnly)
                result.masked++;
            result.changes.push({ userId: u.userId, previous, next });
        }
        catch (e) {
            result.failed++;
            onError(u, e);
        }
    }
    return result;
}
