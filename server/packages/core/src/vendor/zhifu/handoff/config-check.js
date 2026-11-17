import { isCenterUrl, subjectViolations } from "./policy.js";
/** Kinds that talk to a payment company directly: their product text must be generated (`subjectFormat`). */
const DIRECT_KINDS = new Set(["aggregator", "alipay", "shouqianba", "paofen"]);
const SECRET_KEY = /secret|key|password|passwd|token|cert|private/i;
/**
 * Save-time hand-off check of a channel config; [] = OK. Credentials may be undefined (unchanged).
 * Pure: the caller turns problems into a BAD_REQUEST.
 */
export function handoffConfigProblems(kind, rule, credentials, centerBase) {
    const out = [];
    if (DIRECT_KINDS.has(kind) && !rule.subjectFormat)
        out.push("直连支付公司的通道必须设「商品描述格式」（subjectFormat），不能把站点订单标题发给上游");
    for (const [key, value] of Object.entries(credentials ?? {})) {
        if (typeof value !== "string" || key === "apiBase" || SECRET_KEY.test(key))
            continue;
        if (/^https?:\/\//i.test(value)) {
            if (!isCenterUrl(value, centerBase))
                out.push(`凭据 ${key}：回调 / 返回地址只能用支付中心域名，不能用游戏站域名`);
            continue;
        }
        const bad = subjectViolations(value);
        if (bad.length)
            out.push(`凭据 ${key} 含敏感词：${bad.join("、")}`);
    }
    return out;
}
