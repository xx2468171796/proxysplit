/**
 * 「每天最多自助找回几次密码」闸门。
 *
 * 这是从 5FFCG / 5FF / V7 / 5EPLAY 四份各写一遍的实现收上来的 —— 四份的**语义**
 * 其实一致，但各自埋了不同的坑（有的按手机号计数、有的失败也计、有的按 UTC 分日），
 * 而这三种写法在代码里都长得一样地合理，只有在真实运营里才分得出对错。
 *
 * 本模块只做闸门，不碰密码本身：宿主先验完短信/邮箱验证码，再 `check` → 改密 → `record`。
 * 改密与吊销会话走 `zhanghao` 的 `resetPassword`。
 *
 * ## 三条不要改掉的语义
 *
 * 1. **按 userId 计数，不按手机号/邮箱。**
 *    标识符是输入、用户才是资产。按标识符计的话，站点哪天再开一条邮箱找回或客服找回，
 *    换条路就能绕过去 —— 而「绕过去了」这件事不会有任何报错。
 *
 * 2. **只有重置成功才计数。**
 *    验证码输错、新密码太短这类失败不占配额。走到找回这条路的人**已经进不去账号**了，
 *    让他手抖两次就今天彻底没戏，等于把真用户锁在门外；而攻击者本来就过不了验证码那关，
 *    失败计数拦不住他，只拦得住手滑的人。
 *
 * 3. **失败放行(fail-open)。**
 *    这是防滥用闸门，不是安全边界 —— 真正挡人的是验证码本身。KV 抖一下就让全站所有人
 *    都改不了密码，代价远大于多放几次重置。
 *
 * 与发码限流是两回事：发码那层限的是「发几条短信」(花钱)，这层限的是「真的改成功了几次」。
 */
/** 业主口径：默认每天一次。 */
export const DEFAULT_DAILY_LIMIT = 1;
/**
 * 北京自然日的 `YYYY-MM-DD`。
 *
 * 用固定 +8 偏移而不是 Intl 时区库：中国大陆**不实行夏令时**，UTC+8 恒定，
 * 所以固定偏移在这里是精确的而不是近似。（其它时区不能照抄这个写法。）
 *
 * 为什么必须是自然日而不是滚动 24 小时：玩家理解的「今天用过了、明天再来」是挂历上的
 * 明天。按滚动窗口算的话，他半夜 23:50 用掉一次，第二天一整个白天都还被挡着，
 * 而页面上写的是「每天 1 次」—— 这种不一致没有任何一方能自己看懂。
 */
export function beijingDayBucket(now) {
    return new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
}
/** 桶活到次日北京 0 点再多留 1 小时，省得算时区边界；反正次日是新键。 */
export function bucketTtlSec(now) {
    const bj = now + 8 * 3600_000;
    const nextMidnight = Math.floor(bj / 86400_000) * 86400_000 + 86400_000;
    return Math.ceil((nextMidnight - bj) / 1000) + 3600;
}
export function createPasswordResetQuota(opts) {
    const now = opts.now ?? (() => Date.now());
    const keyOf = (userId) => `${opts.keyPrefix}:pwreset:daily:${userId}:${beijingDayBucket(now())}`;
    const readUsed = async (userId) => {
        try {
            return (await opts.kv.count(keyOf(userId))) || 0;
        }
        catch {
            return 0; // fail-open，见文件头第 3 条
        }
    };
    return {
        used: readUsed,
        async check(userId) {
            const limit = Number(await opts.limit());
            if (!Number.isFinite(limit) || limit <= 0)
                return { ok: true, used: 0, limit: 0 };
            const used = await readUsed(userId);
            if (used >= limit) {
                return {
                    ok: false,
                    used,
                    limit,
                    message: `今日找回密码次数已达上限（每天 ${limit} 次），请明天再试或联系客服`,
                };
            }
            return { ok: true, used, limit };
        },
        async record(userId) {
            try {
                const t = now();
                await opts.kv.bump(keyOf(userId), bucketTtlSec(t));
            }
            catch {
                /* 计数失败不影响已完成的重置 */
            }
        },
    };
}
