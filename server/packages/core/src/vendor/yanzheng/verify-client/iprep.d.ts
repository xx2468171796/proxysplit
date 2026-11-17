import type { CallResult } from "./fail-mode.ts";
export type IprepVerdict = "allow" | "deny";
export type IprepReason = "overseas" | "anonymous" | "ip_blocked" | "ip_risk";
export type IprepLevel = "低" | "中" | "高";
export type IprepRegion = "中国大陆" | "港澳台" | "境外" | "未知";
export type IprepManual = "allow" | "block";
export type IprepOutcomeKind = "paid" | "unpaid" | "rejected";
export interface IprepFlags {
    hosting: boolean;
    tor: boolean;
    drop: boolean;
    cloud: string | null;
    asn: number | null;
    asOrg: string | null;
}
export interface IprepResult {
    verdict: IprepVerdict;
    reason: IprepReason | null;
    /** true = 仅观察期,verdict 不应真的拦 */
    observeOnly: boolean;
    score: number;
    level: IprepLevel;
    region: IprepRegion;
    place: string | null;
    flags: IprepFlags;
    manual: IprepManual | null;
    rulesRev: number;
}
export interface IprepCheckInput {
    ip: string;
    context: string;
    deviceFp?: string;
}
export interface IprepOutcomeInput {
    ip: string;
    context: string;
    outcome: IprepOutcomeKind;
    ref: string;
    amountCents?: bigint | number;
}
export interface IprepCallOptions {
    timeoutMs?: number;
}
export declare const IPREP_DEFAULT_TIMEOUT_MS = 800;
/** 内部传输缝:由 createSecurityClient 注入(签名 + node:http) */
export type IprepCall = <T>(path: string, input: object, timeoutMs: number) => Promise<CallResult<T>>;
/** 手写守卫:形状不对返回 null(调用方当服务不可用) */
export declare function parseIprepResult(v: unknown): IprepResult | null;
export declare function createIprep(call: IprepCall): {
    check(input: IprepCheckInput, opts?: IprepCallOptions): Promise<IprepResult | null>;
    outcome(input: IprepOutcomeInput, opts?: IprepCallOptions): Promise<boolean>;
};
export type Iprep = ReturnType<typeof createIprep>;