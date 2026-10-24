/**
 * 后台侧处理器。**鉴权不在这里**:宿主的管理员守卫先行,operatorId = 当前管理员 id(写审计)。
 * 列表返回 users: { id → 名字 } 方便后台显示(后台不打码)。
 */
import type { Fenxiao, FxLogger } from "../service.ts";
import { type HttpResult, type NameLookup } from "./shared.ts";
export interface AdminHandlerOptions {
    names?: NameLookup;
    /** 后台按用户名搜:名字 → 一批 id(成员列表的 q 参数用) */
    searchUsers?: (q: string) => Promise<string[]>;
    now?: () => Date;
    logger?: FxLogger;
}
export declare function createAdminHandlers(fx: Fenxiao, o?: AdminHandlerOptions): {
    overview: (query: unknown) => Promise<HttpResult>;
    leaderboard: (query: unknown) => Promise<HttpResult>;
    members: (query: unknown) => Promise<HttpResult>;
    setMember: (operatorId: string, userId: string, body: unknown) => Promise<HttpResult>;
    /** { parentUserId: string | null } */
    moveMember: (operatorId: string, userId: string, body: unknown) => Promise<HttpResult>;
    commissions: (query: unknown) => Promise<HttpResult>;
    /** { action: approve | void, note? } */
    reviewCommission: (operatorId: string, id: string, body: unknown) => Promise<HttpResult>;
    /** { userId, amount(可负), reason, ref? } */
    adjust: (operatorId: string, body: unknown) => Promise<HttpResult>;
    withdrawals: (query: unknown) => Promise<HttpResult>;
    /** { action: paid | rejected, note? }(驳回必须写 note) */
    reviewWithdrawal: (operatorId: string, id: string, body: unknown) => Promise<HttpResult>;
    applications: (query: unknown) => Promise<HttpResult>;
    /** { action: approve | reject, note? } */
    reviewApplication: (operatorId: string, id: string, body: unknown) => Promise<HttpResult>;
    audit: (query: unknown) => Promise<HttpResult>;
};
export type FenxiaoAdminHandlers = ReturnType<typeof createAdminHandlers>;