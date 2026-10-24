import { FenxiaoError, FxErrorCodes } from "../types.js";
export const KIND_BY_STATUS = {
    400: "invalid",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    429: "rate_limited",
    503: "unavailable",
    500: "internal",
};
export function kindOfStatus(status) {
    return KIND_BY_STATUS[status] ?? (status >= 500 ? "internal" : "invalid");
}
export const HTTP_STATUS_BY_CODE = {
    FX_POLICY_INVALID: 400,
    FX_INPUT_INVALID: 400,
    FX_NOT_FOUND: 404,
    FX_TIER_NOT_FOUND: 400,
    FX_CODE_TAKEN: 409,
    FX_CODE_INVALID: 400,
    FX_NOT_ELIGIBLE: 403,
    FX_CYCLE: 409,
    FX_AMOUNT_INVALID: 400,
    FX_BELOW_MIN_WITHDRAWAL: 400,
    FX_INSUFFICIENT_BALANCE: 409,
    FX_ALREADY_CLOSED: 409,
    FX_APPLICATION_CLOSED: 409,
};
export function err(status, code, message) {
    return { status, body: { code, message, kind: kindOfStatus(status) } };
}
/** bigint → 字符串、Date → ISO,别的原样(递归) */
export function toJson(v) {
    if (typeof v === "bigint")
        return v.toString();
    if (v instanceof Date)
        return v.toISOString();
    if (Array.isArray(v))
        return v.map(toJson);
    if (v instanceof Map)
        return Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), toJson(x)]));
    if (typeof v === "object" && v !== null)
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)]));
    return v;
}
/** 跑一个处理:成功 200 + JSON 安全的 body;FenxiaoError → 对应状态;其它 → 500(不把内部错误吐给前端) */
export async function handle(logger, fn) {
    try {
        return { status: 200, body: toJson(await fn()) };
    }
    catch (e) {
        if (e instanceof FenxiaoError)
            return err(HTTP_STATUS_BY_CODE[e.code] ?? 400, e.code, e.message);
        logger?.error("fenxiao http 处理出错", { err: e instanceof Error ? e.message : String(e) });
        return err(500, "FX_INTERNAL", "服务器出错了,请稍后再试");
    }
}
export const asBody = (v) => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : {});
const bad = (message) => {
    throw new FenxiaoError(FxErrorCodes.INPUT_INVALID, message);
};
export function str(b, k, max = 200) {
    const v = b[k];
    if (v === undefined || v === null || v === "")
        return undefined;
    if (typeof v !== "string")
        return bad(`${k} 必须是字符串`);
    return v.slice(0, max);
}
export function reqStr(b, k, max = 200) {
    return str(b, k, max) ?? bad(`缺少 ${k}`);
}
/** 整数金额:接受整数 number 或数字字符串 */
export function amount(b, k) {
    const v = b[k];
    if (typeof v === "number" && Number.isSafeInteger(v))
        return BigInt(v);
    if (typeof v === "string" && /^-?\d{1,18}$/.test(v))
        return BigInt(v);
    return bad(`${k} 必须是整数金额(最小单位,如分)`);
}
export function int(b, k) {
    const v = b[k];
    if (v === undefined || v === null || v === "")
        return undefined;
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isInteger(n) && Math.abs(n) <= 1_000_000_000 ? n : bad(`${k} 必须是整数`);
}
/** 路径里的记录 id(bigserial):不是数字就当不存在,别让 ::bigint 转换报 500 */
export function idOf(id) {
    if (!/^\d{1,18}$/.test(id))
        throw new FenxiaoError(FxErrorCodes.NOT_FOUND, "记录不存在");
    return id;
}
export function oneOf(b, k, allowed) {
    const v = str(b, k, 40);
    if (v === undefined)
        return undefined;
    return allowed.includes(v) ? v : bad(`${k} 只能是 ${allowed.join(" / ")}`);
}
export function reqOneOf(b, k, allowed) {
    return oneOf(b, k, allowed) ?? bad(`缺少 ${k}`);
}
/** 分页 + 时间窗(days)参数 */
export function pageOf(b) {
    const limit = int(b, "limit");
    const offset = int(b, "offset");
    return { ...(limit === undefined ? {} : { limit }), ...(offset === undefined ? {} : { offset }) };
}
export function sinceDays(b, now, fallback) {
    const days = Math.min(3650, Math.max(1, int(b, "days") ?? fallback));
    return new Date(now.getTime() - days * 86_400_000);
}
/** 「zhangsan」→「z***n」;2 个字以内 →「*」补齐 */
export function maskName(name) {
    const chars = [...name];
    if (chars.length <= 2)
        return `${chars[0] ?? ""}*`;
    return `${chars[0]}***${chars[chars.length - 1]}`;
}
export async function namesOf(lookup, ids, mask) {
    const list = [...new Set(ids)];
    if (!lookup || list.length === 0)
        return {};
    const m = await lookup(list);
    return Object.fromEntries(list.filter((id) => m.has(id)).map((id) => [id, mask ? maskName(m.get(id) ?? "") : (m.get(id) ?? "")]));
}
