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
function isResult(value) {
    return typeof value === "object" && value !== null && typeof value.status === "number" && "body" in value;
}
/** 4xx / 5xx 且错误体有 code、还没 kind：补上 kind；别的原样返回 */
export function withKind(result) {
    if (!isResult(result) || result.status < 400)
        return result;
    const body = result.body;
    if (typeof body !== "object" || body === null || typeof body.code !== "string" || "kind" in body)
        return result;
    return { ...result, body: { ...body, kind: kindOfStatus(result.status) } };
}
/** 处理器对象的每个方法（含一层嵌套对象）返回的结果都过 withKind */
export function withErrorKinds(handlers) {
    const out = {};
    for (const [name, value] of Object.entries(handlers)) {
        if (typeof value === "function") {
            out[name] = (...args) => {
                const result = value.apply(handlers, args);
                return result instanceof Promise ? result.then(withKind) : withKind(result);
            };
        }
        else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            out[name] = withErrorKinds(value);
        }
        else
            out[name] = value;
    }
    return out;
}
