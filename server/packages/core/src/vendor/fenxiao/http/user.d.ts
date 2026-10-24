import type { Fenxiao, FxLogger } from "../service.ts";
import { type HttpResult, type NameLookup } from "./shared.ts";
export interface UserHandlerOptions {
    names?: NameLookup;
    /** 邀请链接:code → 完整链接(如 https://site/?ref=CODE) */
    inviteLink?: (code: string) => string;
    logger?: FxLogger;
}
export declare function createUserHandlers(fx: Fenxiao, o?: UserHandlerOptions): {
    me: (userId: string) => Promise<HttpResult>;
    /** 领邀请码(有资格才行) */
    ensureCode: (userId: string) => Promise<HttpResult>;
    /** 我的团队:level 不传 = 全部层级 */
    team: (userId: string, query: unknown) => Promise<HttpResult>;
    /** 我的佣金明细(买家打码) */
    commissions: (userId: string, query: unknown) => Promise<HttpResult>;
    withdrawals: (userId: string, query: unknown) => Promise<HttpResult>;
    /** 申请提现:{ amount, payee: { method, account, name } } */
    withdraw: (userId: string, body: unknown) => Promise<HttpResult>;
    /** 申请成为推广员:{ message? } */
    apply: (userId: string, body: unknown) => Promise<HttpResult>;
};
export type FenxiaoUserHandlers = ReturnType<typeof createUserHandlers>;