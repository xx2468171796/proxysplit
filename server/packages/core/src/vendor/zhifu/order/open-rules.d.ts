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
import { type PayRules } from "./cooldown.ts";
export interface OpenOrderRules {
    reuse: boolean;
    singleOpen: boolean;
    quickCancelSec: number;
    quickCancelWeight: number;
}
export interface DeviceRules {
    enabled: boolean;
    /** 设备连续未付走和玩家同一套阶梯（rules.ladderSec） */
    ladder: boolean;
    /** 设备连续未付到第几笔封设备；0 = 不封 */
    banAfterUnpaid: number;
    /** 每设备最近 1 小时最多几笔未付；0 = 不限 */
    maxUnpaidPerHour: number;
}
export interface IpRules {
    enabled: boolean;
    maxUnpaidPerHour: number;
    /** 同一 IP 同时挂着的未付订单上限；0 = 不限 */
    maxOpen: number;
}
export interface TrustRules {
    requirePhone: boolean;
    minAccountAgeMin: number;
    /** 不要求手机号的站（app id），例如没有手机号体系的 5FD */
    exemptSites: string[];
}
export declare const DEFAULT_OPEN_RULES: OpenOrderRules;
export declare const DEFAULT_DEVICE_RULES: DeviceRules;
export declare const DEFAULT_IP_RULES: IpRules;
export declare const DEFAULT_TRUST_RULES: TrustRules;
export interface WeightedOrder {
    status: string;
    createdAt: Date;
    /** 站点替玩家取消的时间（快速取消减半用） */
    cancelledAt?: Date | null;
}
/** 一笔单在连续未付里算几笔：快速取消 = quickCancelWeight，其他 = 1 */
export declare function unpaidWeight(o: WeightedOrder, r: Pick<OpenOrderRules, "quickCancelSec" | "quickCancelWeight">): number;
/** 加权连续未付（倒序，遇到已付停），向下取整：两次快速取消 = 1 笔 */
export declare function weightedUnpaidStreak(recent: readonly WeightedOrder[], r: Pick<OpenOrderRules, "quickCancelSec" | "quickCancelWeight">): number;
export type LimitRule = "device" | "ip" | "trust";
export interface LimitVerdict {
    /** null = 放行 */
    rule: LimitRule | null;
    waitSec: number;
    message: string | null;
    /** 设备连续未付达到封禁笔数（调用方落库封设备） */
    banDevice?: boolean;
}
export interface DeviceFacts {
    /** 该设备加权连续未付 */
    streak: number;
    /** 该设备最近一笔下单时间 */
    lastAt: Date | null;
    /** 该设备最近 1 小时未付笔数 */
    unpaidLastHour: number;
    /** 最近 1 小时里最早那笔未付的下单时间（算还要等多久） */
    oldestUnpaidInHour: Date | null;
}
export declare const DEVICE_BANNED_MESSAGE = "\u6B64\u8BBE\u5907\u7684\u652F\u4ED8\u6743\u9650\u5DF2\u88AB\u6682\u505C\uFF0C\u5982\u6709\u7591\u95EE\u8BF7\u8054\u7CFB\u5BA2\u670D";
/** 设备：封禁 → 每小时上限 → 阶梯 */
export declare function judgeDevice(f: DeviceFacts, now: number, rules: PayRules, d: DeviceRules): LimitVerdict;
export interface IpFacts {
    unpaidLastHour: number;
    oldestUnpaidInHour: Date | null;
    openNow: number;
}
/** IP：同时挂着的单上限 → 每小时未付上限（不封、不走阶梯） */
export declare function judgeIp(f: IpFacts, now: number, r: IpRules): LimitVerdict;
export interface TrustFacts {
    appId: string;
    /** 站点传了手机号或会员中心账号 */
    hasPhoneOrHub: boolean;
    /** 站点报的账号注册时长（秒）；没报 = 不判注册时长 */
    accountAgeSec?: number | null;
}
export declare const TRUST_PHONE_MESSAGE = "\u4E3A\u4E86\u4FDD\u969C\u60A8\u7684\u8D44\u91D1\u5B89\u5168\uFF0C\u8BF7\u5148\u7ED1\u5B9A\u624B\u673A\u53F7\u540E\u518D\u5145\u503C";
export declare function judgeTrust(f: TrustFacts, r: TrustRules): LimitVerdict;
/** 下单后弹窗里「未付会怎样」要用的数字（服务端按当前规则算好，站点只拿来显示） */
export interface UnpaidStatus {
    /** 今天（北京时间）已有几笔未付（不含本单） */
    today: number;
    /** 本单之前的连续未付（加权取整） */
    streak: number;
    /** 本单如不支付，下一单要等几秒 */
    nextWaitSec: number;
    /** 再有几笔未付将暂停支付权限（含本单）；0 = 不封 */
    leftBeforeBan: number;
}
export declare function unpaidStatusFor(today: number, streak: number, rules: PayRules): UnpaidStatus;
/** 被拦时补一句「再有几笔将暂停支付权限」 */
export declare function banTail(leftBeforeBan: number): string;