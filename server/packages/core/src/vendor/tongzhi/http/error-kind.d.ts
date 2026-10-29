/**
 * 统一错误格式（公司基础契约 jichu 的 ErrorBody）：错误体除了 code / message 再带 kind，
 * 前端 / AI 按 kind 处理（没登录、没权限、不存在、冲突、限流……），不用记每个包的错误码。
 * 状态码 → kind 的表和 jichu STATUS_OF 一致（test/error-kind.test.ts 对账，改了那边这里会红）；
 * 不 import jichu：包从 git 装，不想多一层运行时依赖。
 */
export type ErrorKind = "invalid" | "unauthenticated" | "forbidden" | "not_found" | "conflict" | "rate_limited" | "unavailable" | "internal";
export declare const KIND_BY_STATUS: Readonly<Record<number, ErrorKind>>;
export declare function kindOfStatus(status: number): ErrorKind;
/** 4xx / 5xx 且错误体有 code、还没 kind：补上 kind；别的原样返回 */
export declare function withKind<T>(result: T): T;
/** 处理器对象的每个方法（含一层嵌套对象）返回的结果都过 withKind */
export declare function withErrorKinds<H extends object>(handlers: H): H;