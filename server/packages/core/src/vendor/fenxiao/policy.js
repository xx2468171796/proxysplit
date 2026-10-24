/**
 * 规则:默认值、合法性校验、按人取比例、按商品取规则。纯函数,没有 IO。
 */
import { FenxiaoError, FxErrorCodes } from "./types.js";
export const BPS = 10_000;
/** 上级链最长存多少级(多存几级给后台看团队;分佣只取前 maxLevels 级) */
export const MAX_CHAIN = 20;
/** 不开 allowDeepLevels 时最多返几级 */
export const SAFE_LEVELS = 3;
/** 开了 allowDeepLevels 也最多返几级 */
export const MAX_LEVELS = 10;
/** 商品倍率上限(3 倍) */
const MAX_MULTIPLIER = 30_000;
export const DEFAULT_FX_POLICY = {
    enabled: false,
    mode: "level",
    maxLevels: 2,
    allowDeepLevels: false,
    openToAll: false,
    defaultRates: [],
    tiers: [],
    totalCapBps: BPS,
    freezeDays: 7,
    minBaseAmount: 0n,
    holdAbove: 0n,
    products: [],
    recurring: { maxOrders: 0, withinDays: 0 },
    application: "off",
    applicationTierCode: null,
    minWithdrawal: 100n,
    withdrawalFeeBps: 0,
    withdrawalFeeFixed: 0n,
};
/** 宿主存的规则可能是旧版本(少字段):先补默认值再用 */
export function withPolicyDefaults(p) {
    const out = { ...DEFAULT_FX_POLICY, ...p, recurring: { ...DEFAULT_FX_POLICY.recurring, ...p.recurring } };
    // 宿主从 JSON 配置里读出来的金额常是 number / 字符串:统一成 bigint(坏值留原样,交给 assertFxPolicy 报错)
    for (const k of MONEY_KEYS)
        out[k] = toMoney(out[k]) ?? out[k];
    return out;
}
export const MONEY_KEYS = ["minBaseAmount", "holdAbove", "minWithdrawal", "withdrawalFeeFixed"];
/** 整数金额:bigint / 安全整数 number / 整数字符串 → bigint;别的 → null */
export function toMoney(v) {
    if (typeof v === "bigint")
        return v;
    if (typeof v === "number" && Number.isSafeInteger(v))
        return BigInt(v);
    if (typeof v === "string" && /^-?\d{1,18}$/.test(v))
        return BigInt(v);
    return null;
}
const CODE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const PRODUCT_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
function fail(message) {
    throw new FenxiaoError(FxErrorCodes.POLICY_INVALID, message);
}
function assertInt(v, min, max, field) {
    if (!Number.isInteger(v) || v < min || v > max)
        fail(`${field} 必须是 ${min}~${max} 的整数`);
}
export function assertRates(rates, field) {
    if (!Array.isArray(rates) || rates.length > MAX_LEVELS)
        fail(`${field} 最多 ${MAX_LEVELS} 级`);
    for (const [i, r] of rates.entries())
        assertInt(r, 0, BPS, `${field}[${i}](万分比)`);
}
function assertTiers(tiers) {
    const seen = new Set();
    for (const t of tiers) {
        if (typeof t !== "object" || t === null || typeof t.code !== "string" || typeof t.name !== "string")
            fail("等级要有 code 和 name");
        if (!CODE_RE.test(t.code))
            fail(`等级代码 ${t.code} 只能是小写字母数字与 - _`);
        if (seen.has(t.code))
            fail(`等级代码 ${t.code} 重复`);
        seen.add(t.code);
        if (!t.name.trim())
            fail(`等级 ${t.code} 缺名称`);
        assertRates(t.rates, `tiers.${t.code}.rates`);
    }
}
function assertProducts(products) {
    const seen = new Set();
    for (const r of products) {
        if (typeof r !== "object" || r === null || typeof r.key !== "string")
            fail("商品规则要有 key");
        if (!PRODUCT_RE.test(r.key))
            fail(`商品代码 ${r.key} 不合法(字母数字 _ . : -,≤64)`);
        if (seen.has(r.key))
            fail(`商品代码 ${r.key} 重复`);
        seen.add(r.key);
        if (r.multiplierBps !== undefined)
            assertInt(r.multiplierBps, 0, MAX_MULTIPLIER, `products.${r.key}.multiplierBps`);
    }
}
function assertMoney(p) {
    for (const k of MONEY_KEYS)
        if (typeof p[k] !== "bigint")
            fail(`${k} 必须是整数金额`);
    if (p.minBaseAmount < 0n)
        fail("minBaseAmount 不能为负");
    if (p.holdAbove < 0n)
        fail("holdAbove 不能为负");
    if (p.minWithdrawal < 1n)
        fail("minWithdrawal 至少为 1");
    assertInt(p.withdrawalFeeBps, 0, BPS, "withdrawalFeeBps");
    if (p.withdrawalFeeFixed < 0n)
        fail("withdrawalFeeFixed 不能为负");
}
/** 规则合法性:宿主把配置转成 FxPolicy 后先过一遍(后台保存时也调),坏规则别发到一半 */
function assertShape(p) {
    for (const k of ["enabled", "allowDeepLevels", "openToAll"])
        if (typeof p[k] !== "boolean")
            fail(`${k} 必须是 true / false`);
    if (!Array.isArray(p.tiers) || !Array.isArray(p.products))
        fail("tiers / products 必须是数组");
}
export function assertFxPolicy(p) {
    assertShape(p);
    if (p.mode !== "level" && p.mode !== "differential")
        fail("mode 只能是 level / differential");
    const cap = p.allowDeepLevels ? MAX_LEVELS : SAFE_LEVELS;
    if (!Number.isInteger(p.maxLevels) || p.maxLevels < 1 || p.maxLevels > cap) {
        fail(p.allowDeepLevels ? `maxLevels 必须是 1~${MAX_LEVELS}` : `maxLevels 最多 ${SAFE_LEVELS}(要更多须 allowDeepLevels,合规自负)`);
    }
    assertRates(p.defaultRates, "defaultRates");
    assertTiers(p.tiers);
    assertInt(p.totalCapBps, 0, BPS, "totalCapBps");
    assertInt(p.freezeDays, 0, 365, "freezeDays");
    assertMoney(p);
    assertProducts(p.products);
    assertInt(p.recurring.maxOrders, 0, 100_000, "recurring.maxOrders");
    assertInt(p.recurring.withinDays, 0, 36_500, "recurring.withinDays");
    if (!["off", "review", "auto"].includes(p.application))
        fail("application 只能是 off / review / auto");
    if (p.application !== "off" && p.applicationTierCode === null && !p.openToAll)
        fail("开放申请时要指定通过后给的等级(applicationTierCode),或打开人人可推广");
    if (p.applicationTierCode !== null && !findTier(p, p.applicationTierCode))
        fail(`applicationTierCode ${p.applicationTierCode} 不在等级里`);
}
export function findTier(policy, code) {
    return code === null ? null : (policy.tiers.find((t) => t.code === code) ?? null);
}
export function productRule(policy, key) {
    return key ? (policy.products.find((r) => r.key === key) ?? null) : null;
}
/**
 * 某位上级能拿的逐级比例:停用 → null;逐人覆盖 > 等级 > (人人可推广时)默认;都没有 → null。
 * 等级 code 在规则里找不到(后台删了档)按普通用户处理,不会因为删档把人卡死。
 */
export function ratesFor(policy, m) {
    if (!m.enabled)
        return null;
    if (m.rateOverride)
        return m.rateOverride;
    const tier = findTier(policy, m.tierCode);
    if (tier)
        return tier.rates;
    return policy.openToAll ? policy.defaultRates : null;
}
/** 能不能推广(领码):设了有效等级,或人人可推广 */
export function canPromote(policy, m) {
    if (m && !m.enabled)
        return false;
    return policy.openToAll || findTier(policy, m?.tierCode ?? null) !== null;
}
/** 提现手续费:比例 + 固定额,不超过金额本身 */
export function withdrawalFee(policy, amount) {
    const fee = (amount * BigInt(policy.withdrawalFeeBps)) / BigInt(BPS) + policy.withdrawalFeeFixed;
    return fee > amount ? amount : fee;
}
