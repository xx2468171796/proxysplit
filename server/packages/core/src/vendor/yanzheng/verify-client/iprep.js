/**
 * IP 信誉客户端(2.35.0):支付下单前问雷池「这个 IP 能不能下单」,单结束后回报结果。
 *
 * - `check`:服务不可用(网络错 / 超时 / 5xx / 签名或 Host 配置错 / 响应形状不对)一律返回 `null`,**绝不抛**;
 *   调用方按 null 走自己的本地兜底(fail-open)。
 * - `outcome`:返回 true = 雷池已收;任何失败返回 false,绝不抛。
 * - 入参在本地先校验(ip / context / ref),不合法直接抛 TypeError —— 那是调用方代码的 bug,不是可用性问题。
 */
import { isIP } from "node:net";
export const IPREP_DEFAULT_TIMEOUT_MS = 800;
const CONTEXT_RE = /^[a-z_]{1,32}$/;
const VERDICTS = ["allow", "deny"];
const REASONS = ["overseas", "anonymous", "ip_blocked", "ip_risk"];
const LEVELS = ["低", "中", "高"];
const REGIONS = ["中国大陆", "港澳台", "境外", "未知"];
const MANUALS = ["allow", "block"];
const OUTCOMES = ["paid", "unpaid", "rejected"];
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isBool = (v) => typeof v === "boolean";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const strOrNull = (v) => v === null || typeof v === "string";
const numOrNull = (v) => v === null || isNum(v);
const oneOf = (v, list) => typeof v === "string" && list.includes(v);
function validFlags(f) {
    return isBool(f.hosting) && isBool(f.tor) && isBool(f.drop) && strOrNull(f.cloud) && numOrNull(f.asn) && strOrNull(f.asOrg);
}
function validEnums(v) {
    return oneOf(v.verdict, VERDICTS) && (v.reason === null || oneOf(v.reason, REASONS)) && oneOf(v.level, LEVELS) && oneOf(v.region, REGIONS) && (v.manual === null || oneOf(v.manual, MANUALS));
}
/** 手写守卫:形状不对返回 null(调用方当服务不可用) */
export function parseIprepResult(v) {
    if (!isObj(v) || !isObj(v.flags))
        return null;
    const ok = validEnums(v) && isBool(v.observeOnly) && isNum(v.score) && strOrNull(v.place) && isNum(v.rulesRev) && validFlags(v.flags);
    return ok ? v : null;
}
function assertBase(ip, context) {
    if (typeof ip !== "string" || isIP(ip) === 0)
        throw new TypeError("[verify-client] iprep: ip 必须是合法 IPv4/IPv6");
    if (typeof context !== "string" || !CONTEXT_RE.test(context))
        throw new TypeError("[verify-client] iprep: context 须匹配 [a-z_]{1,32}");
}
/** 校验 outcome 入参,返回要发送的整数分(没传 = undefined) */
function validateOutcome(input) {
    assertBase(input.ip, input.context);
    if (!OUTCOMES.includes(input.outcome))
        throw new TypeError("[verify-client] iprep: outcome 须为 paid / unpaid / rejected");
    if (typeof input.ref !== "string" || input.ref.length < 1 || input.ref.length > 64)
        throw new TypeError("[verify-client] iprep: ref 长度须 1–64");
    if (input.amountCents === undefined)
        return undefined;
    const n = typeof input.amountCents === "bigint" ? Number(input.amountCents) : input.amountCents;
    if (!Number.isSafeInteger(n) || n < 0)
        throw new TypeError("[verify-client] iprep: amountCents 须为非负安全整数");
    return n;
}
export function createIprep(call) {
    return {
        async check(input, opts = {}) {
            assertBase(input.ip, input.context);
            const deviceFp = input.deviceFp && input.deviceFp.length <= 256 ? input.deviceFp : undefined;
            const r = await call("/v1/s/iprep/check", { ip: input.ip, context: input.context, deviceFp }, opts.timeoutMs ?? IPREP_DEFAULT_TIMEOUT_MS);
            return r.status === "ok" ? parseIprepResult(r.body) : null;
        },
        async outcome(input, opts = {}) {
            const amountCents = validateOutcome(input);
            const r = await call("/v1/s/iprep/outcome", { ip: input.ip, context: input.context, outcome: input.outcome, ref: input.ref, amountCents }, opts.timeoutMs ?? IPREP_DEFAULT_TIMEOUT_MS);
            return r.status === "ok" && r.body.ok !== false;
        },
    };
}
