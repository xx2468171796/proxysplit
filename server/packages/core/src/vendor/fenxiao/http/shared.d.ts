/**
 * HTTP 处理器共用:结果形状、错误 → { status, body:{code,message,kind} }(和 jichu ErrorBody 一致)、
 * JSON 安全(bigint → 字符串,Date → ISO)、入参收窄。
 */
import type { FxLogger } from "../service.ts";
import { type FxErrorCode } from "../types.ts";
/** 和 jichu ErrorKind 一致(test/error-kind.test.ts 对账) */
export type ErrorKind = "invalid" | "unauthenticated" | "forbidden" | "not_found" | "conflict" | "rate_limited" | "unavailable" | "internal";
export declare const KIND_BY_STATUS: Readonly<Record<number, ErrorKind>>;
export declare function kindOfStatus(status: number): ErrorKind;
export declare const HTTP_STATUS_BY_CODE: Readonly<Record<FxErrorCode, number>>;
export interface FxErrorBody {
    code: string;
    message: string;
    kind: ErrorKind;
}
export type HttpResult<T = unknown> = {
    status: number;
    body: T;
} | {
    status: number;
    body: FxErrorBody;
};
export declare function err(status: number, code: string, message: string): {
    status: number;
    body: FxErrorBody;
};
/** bigint → 字符串、Date → ISO,别的原样(递归) */
export declare function toJson(v: unknown): unknown;
/** 跑一个处理:成功 200 + JSON 安全的 body;FenxiaoError → 对应状态;其它 → 500(不把内部错误吐给前端) */
export declare function handle(logger: FxLogger | undefined, fn: () => Promise<unknown>): Promise<HttpResult>;
export type Body = Record<string, unknown>;
export declare const asBody: (v: unknown) => Body;
export declare function str(b: Body, k: string, max?: number): string | undefined;
export declare function reqStr(b: Body, k: string, max?: number): string;
/** 整数金额:接受整数 number 或数字字符串 */
export declare function amount(b: Body, k: string): bigint;
export declare function int(b: Body, k: string): number | undefined;
/** 路径里的记录 id(bigserial):不是数字就当不存在,别让 ::bigint 转换报 500 */
export declare function idOf(id: string): string;
export declare function oneOf<T extends string>(b: Body, k: string, allowed: readonly T[]): T | undefined;
export declare function reqOneOf<T extends string>(b: Body, k: string, allowed: readonly T[]): T;
/** 分页 + 时间窗(days)参数 */
export declare function pageOf(b: Body): {
    limit?: number;
    offset?: number;
};
export declare function sinceDays(b: Body, now: Date, fallback: number): Date;
/** 显示名投影:宿主给 id → 名字;推广人看到的别人名字打码 */
export type NameLookup = (userIds: string[]) => Promise<Map<string, string>> | Map<string, string>;
/** 「zhangsan」→「z***n」;2 个字以内 →「*」补齐 */
export declare function maskName(name: string): string;
export declare function namesOf(lookup: NameLookup | undefined, ids: Iterable<string>, mask: boolean): Promise<Record<string, string>>;