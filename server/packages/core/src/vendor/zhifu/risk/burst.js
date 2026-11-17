/**
 * 跨账号冷却判定（业主 11-04「换号了 IP 也要算进去」，纯函数）：设备指纹 / IP 短时间未付多或账号多 →
 * 递增冷却。事实（未付数 / 账号数 / 冷却起点）由消费方查库给进来。
 */
const NONE = { waitSec: 0, start: false, reason: null };
/** 生效的放宽：门槛倍数（IP 24h 与老付款玩家取大）、冷却系数。 */
function relaxOf(kind, f, r, payer) {
    const trusted = payer?.enabled === true && f.trustedPayer === true;
    const ipRelax = kind === "ip" && f.paidRecently ? r.ipPaidRelax : 1;
    return {
        trusted,
        threshold: Math.max(ipRelax, trusted && payer ? payer.thresholdMultiplier : 1),
        duration: trusted && payer ? payer.durationFactor : 1,
    };
}
/** 正在冷却 → 等；否则超门槛 → 开下一级。`payer` = 「老付款玩家放宽」规则（可不传）。 */
export function judgeBurst(kind, f, r, now, payer) {
    const x = relaxOf(kind, f, r, payer);
    const durations = r.cooldownSec;
    const levelDur = (i) => Math.max(1, Math.ceil((durations[Math.min(i, durations.length - 1)] ?? 600) * x.duration));
    const last = f.starts.at(-1);
    if (last) {
        const end = last.getTime() + levelDur(f.starts.length - 1) * 1000;
        if (end > now)
            return { waitSec: Math.ceil((end - now) / 1000), start: false, reason: "cooling" };
    }
    const maxUnpaid = (kind === "device" ? r.deviceMaxUnpaid : r.ipMaxUnpaid) * x.threshold;
    const maxAccounts = kind === "ip" ? r.ipMaxAccounts * x.threshold : 0;
    const overUnpaid = maxUnpaid > 0 && f.unpaid >= maxUnpaid;
    const overAccounts = maxAccounts > 0 && f.accounts >= maxAccounts;
    if (!overUnpaid && !overAccounts)
        return NONE;
    const why = overUnpaid ? `unpaid ${f.unpaid}≥${maxUnpaid}` : `accounts ${f.accounts}≥${maxAccounts}`;
    return { waitSec: levelDur(f.starts.length), start: true, reason: x.trusted ? `${why} (payer)` : why };
}
