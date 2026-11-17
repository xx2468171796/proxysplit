/**
 * 付款成功率规则（业主 2026-11-01「不能一直恶意创建」）—— 纯函数，统一支付服务和站点共用这一份，不各写一套：
 *
 * 1. 一人一单：玩家有一笔没过期、没付的订单时，再下单 = 同站同金额直接复用那一笔（二维码过期就换新码，不算新单），
 *    否则让玩家选「继续支付 / 取消后重新下单」。
 * 2. 快速取消减半：下单后 `quickCancelSec`（默认 60 秒）内玩家自己取消，在连续未付里只算 `quickCancelWeight`（默认 0.5）笔，
 *    两次快速取消 = 一笔未付；不设「免费」次数，所以取消重下也绕不过阶梯。
 * 3. 设备 / IP：同一设备指纹单独走一套未付阶梯 + 每小时未付上限 + 连续未付封设备；同一 IP 只设上限（IP 常被共享，不封、不走阶梯）。
 * 4. 信任门槛：有手机号的站，下第一单前要绑手机号（会员中心账号也算）；可选账号注册满 N 分钟。没手机号的站（5FD）在豁免名单里，只靠设备 / IP。
 */
import { formatWait, intervalForStreak } from "./cooldown.js";
export const DEFAULT_OPEN_RULES = { reuse: true, singleOpen: true, quickCancelSec: 60, quickCancelWeight: 0.5 };
export const DEFAULT_DEVICE_RULES = { enabled: true, ladder: true, banAfterUnpaid: 10, maxUnpaidPerHour: 6 };
export const DEFAULT_IP_RULES = { enabled: true, maxUnpaidPerHour: 15, maxOpen: 5 };
export const DEFAULT_TRUST_RULES = { requirePhone: true, minAccountAgeMin: 0, exemptSites: ["5fd"] };
/** 一笔单在连续未付里算几笔：快速取消 = quickCancelWeight，其他 = 1 */
export function unpaidWeight(o, r) {
    if (o.status !== "cancelled" || !o.cancelledAt)
        return 1;
    const sec = (o.cancelledAt.getTime() - o.createdAt.getTime()) / 1000;
    return sec <= r.quickCancelSec ? r.quickCancelWeight : 1;
}
/** 加权连续未付（倒序，遇到已付停），向下取整：两次快速取消 = 1 笔 */
export function weightedUnpaidStreak(recent, r) {
    let n = 0;
    for (const o of recent) {
        if (o.status === "paid" || o.status === "partial")
            break;
        n += unpaidWeight(o, r);
    }
    return Math.floor(n + 1e-9);
}
const PASS = { rule: null, waitSec: 0, message: null };
export const DEVICE_BANNED_MESSAGE = "此设备的支付权限已被暂停，如有疑问请联系客服";
/** 设备：封禁 → 每小时上限 → 阶梯 */
export function judgeDevice(f, now, rules, d) {
    if (!d.enabled)
        return PASS;
    if (d.banAfterUnpaid > 0 && f.streak >= d.banAfterUnpaid) {
        return { rule: "device", waitSec: 0, message: DEVICE_BANNED_MESSAGE, banDevice: true };
    }
    if (d.maxUnpaidPerHour > 0 && f.unpaidLastHour >= d.maxUnpaidPerHour && f.oldestUnpaidInHour) {
        const waitSec = Math.max(1, Math.ceil((f.oldestUnpaidInHour.getTime() + 3600000 - now) / 1000));
        return {
            rule: "device",
            waitSec,
            message: `此设备 1 小时内已有 ${f.unpaidLastHour} 笔订单未支付，请 ${formatWait(waitSec)}后再下单`,
        };
    }
    if (d.ladder && f.streak > 0 && f.lastAt) {
        const left = f.lastAt.getTime() + intervalForStreak(f.streak, rules) * 1000 - now;
        if (left > 0) {
            const waitSec = Math.ceil(left / 1000);
            return {
                rule: "device",
                waitSec,
                message: `此设备已连续 ${f.streak} 笔订单未支付，请 ${formatWait(waitSec)}后再下单`,
            };
        }
    }
    return PASS;
}
/** IP：同时挂着的单上限 → 每小时未付上限（不封、不走阶梯） */
export function judgeIp(f, now, r) {
    if (!r.enabled)
        return PASS;
    if (r.maxOpen > 0 && f.openNow >= r.maxOpen) {
        return { rule: "ip", waitSec: 120, message: "当前网络下待支付的订单太多，请先完成支付或稍后再试" };
    }
    if (r.maxUnpaidPerHour > 0 && f.unpaidLastHour >= r.maxUnpaidPerHour && f.oldestUnpaidInHour) {
        const waitSec = Math.max(1, Math.ceil((f.oldestUnpaidInHour.getTime() + 3600000 - now) / 1000));
        return { rule: "ip", waitSec, message: `当前网络 1 小时内未支付的订单太多，请 ${formatWait(waitSec)}后再下单` };
    }
    return PASS;
}
export const TRUST_PHONE_MESSAGE = "为了保障您的资金安全，请先绑定手机号后再充值";
export function judgeTrust(f, r) {
    const exempt = r.exemptSites.includes(f.appId);
    if (r.requirePhone && !exempt && !f.hasPhoneOrHub)
        return { rule: "trust", waitSec: 0, message: TRUST_PHONE_MESSAGE };
    if (r.minAccountAgeMin > 0 && typeof f.accountAgeSec === "number" && f.accountAgeSec >= 0) {
        const left = r.minAccountAgeMin * 60 - f.accountAgeSec;
        if (left > 0) {
            return { rule: "trust", waitSec: left, message: `新注册账号需 ${formatWait(left)}后才能充值，请稍候` };
        }
    }
    return PASS;
}
export function unpaidStatusFor(today, streak, rules) {
    const after = streak + 1;
    return {
        today,
        streak,
        nextWaitSec: rules.enabled ? intervalForStreak(after, rules) : 0,
        leftBeforeBan: rules.enabled && rules.banAfterUnpaid > 0 ? Math.max(0, rules.banAfterUnpaid - streak) : 0,
    };
}
/** 被拦时补一句「再有几笔将暂停支付权限」 */
export function banTail(leftBeforeBan) {
    return leftBeforeBan > 0 && leftBeforeBan <= 3 ? `（再有 ${leftBeforeBan} 笔未支付将暂停支付权限）` : "";
}
