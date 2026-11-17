/**
 * 跨账号冷却判定（业主 11-04「换号了 IP 也要算进去」，纯函数）：设备指纹 / IP 短时间未付多或账号多 →
 * 递增冷却。事实（未付数 / 账号数 / 冷却起点）由消费方查库给进来。
 */
export interface BurstRules {
    enabled: boolean;
    deviceWindowSec: number;
    deviceMaxUnpaid: number;
    ipWindowSec: number;
    ipMaxUnpaid: number;
    ipAccountsWindowSec: number;
    ipMaxAccounts: number;
    /** 这个 IP 24 小时内付过款 → 门槛 × 它（CGNAT / 共享 Wi-Fi） */
    ipPaidRelax: number;
    cooldownSec: readonly number[];
    escalateWindowSec: number;
}
/**
 * 「老付款玩家放宽」（业主 11-04）：玩家（账号或设备）近 `lookbackDays` 天付过款 → 门槛 × `thresholdMultiplier`、
 * 冷却时长 × `durationFactor`。与 IP 24 小时放宽取大（不叠乘）。关闭 = 不传或 enabled=false。
 */
export interface PayerRelax {
    enabled: boolean;
    lookbackDays: number;
    thresholdMultiplier: number;
    durationFactor: number;
}
export type BurstKind = "device" | "ip";
export interface BurstFacts {
    unpaid: number;
    accounts: number;
    paidRecently: boolean;
    /** 下单玩家（账号或设备）在 `PayerRelax.lookbackDays` 内付过款；消费方没算就不传（= false） */
    trustedPayer?: boolean;
    /** 递增窗口内的冷却起点，旧的在前 */
    starts: readonly Date[];
}
export interface BurstVerdict {
    waitSec: number;
    /** true = 现在开始新一级冷却（消费方记一条起点） */
    start: boolean;
    reason: string | null;
}
/** 正在冷却 → 等；否则超门槛 → 开下一级。`payer` = 「老付款玩家放宽」规则（可不传）。 */
export declare function judgeBurst(kind: BurstKind, f: BurstFacts, r: BurstRules, now: number, payer?: PayerRelax | null): BurstVerdict;