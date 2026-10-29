import type { Zhanghao } from "./service-contract.ts";
import { type AdminUserView, type ErrorBody } from "./http/wire.ts";
export declare const LOOPBACK_IPS: ReadonlySet<string>;
export declare const isLoopbackIp: (ip: string) => boolean;
export interface AccountControlOptions {
    /** 站点 env 里的 ZH_AI_TOKEN;不足 minTokenLength 位视为未配置,闸关闭 */
    token: string | null | undefined;
    /** 默认 32 */
    minTokenLength?: number;
    /** 默认只认本机(127.0.0.1 / ::1)。宿主取 IP 的规则与它的 tongzhi AI 路由保持一致 */
    allowIp?: (ip: string) => boolean;
    /** 调用方自报的名字(进审计),默认头 x-zh-actor */
    actorHeader?: string;
    /**
     * 审计里记的操作人。默认 `ai:<actor>`。
     * 站点审计表的 operator_id 是数字列时(如 6E 的 bigint)传一个固定的系统管理员 id,否则落审计会失败。
     */
    operatorId?: (actor: string) => string;
    /** 非 ZhanghaoError 的异常(store 挂了之类)交给宿主记日志;响应统一 500 不带细节 */
    onInternalError?: (err: unknown) => void;
}
export interface AccountControlRequest {
    method: string;
    /** `*` 那一段,如 "/accounts/123/ban";前导斜杠可有可无 */
    path: string;
    query?: Record<string, string | undefined>;
    body?: unknown;
    /** 宿主按自己的规则取好的客户端 IP */
    ip: string;
    /** 小写键 */
    headers: Record<string, string | string[] | undefined>;
}
export interface AccountControlResult<T = unknown> {
    status: number;
    body: T | ErrorBody;
}
export interface AccountListView {
    items: AdminUserView[];
}
declare function buildZhanghaoAccountControl(zh: Zhanghao, opts: AccountControlOptions): {
    enabled: boolean;
    authenticate: (req: Pick<AccountControlRequest, "ip" | "headers">) => {
        actor: string;
    } | null;
    dispatch: (req: AccountControlRequest) => Promise<AccountControlResult>;
};
export type ZhanghaoAccountControl = ReturnType<typeof createZhanghaoAccountControl>;
/** 对外的处理器：错误体统一带 kind（error-kind.ts，公司基础契约 jichu 的 ErrorBody） */
export declare function createZhanghaoAccountControl(zh: Zhanghao, opts: AccountControlOptions): ReturnType<typeof buildZhanghaoAccountControl>;
export {};