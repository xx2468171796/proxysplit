import type { Zhanghao } from "./service-contract.ts";
import type { PublicUser } from "./types.ts";
/** huiyuan `createSiteHandlers({ lookupUser })` 要的候选形状 */
export interface LookupCandidate {
    siteUserId: string;
    label: string;
    hint?: string;
}
export interface IdentityBridge {
    /** 批量投影(tuiguang / liaotian projectUsers 直接传):每个 id 都有值,查不到用 fallbackDisplayName 兜底 */
    projectUsers(userIds: readonly string[]): Promise<Map<string, PublicUser>>;
    /** 单个是否存在(tuiguang / liaotian userExists 直接传);非法 id 返回 false 不抛 */
    userExists(userId: string): Promise<boolean>;
    /** 后台按 用户名/昵称/邮箱/手机号片段/id 查候选(huiyuan lookupUser 直接传);≤ lookupLimit;hint = 用户名 · 掩码手机 · 注册日期 */
    lookupUser(q: string): Promise<LookupCandidate[]>;
}
export interface IdentityBridgeOptions {
    /** 候选上限,默认 10(huiyuan 的上限也是 10,再多它自己截) */
    lookupLimit?: number;
    /**
     * 查不到的 id 用什么名字兜底。**与 createZhanghao 的 `config.fallbackDisplayName` 传同一个函数**,
     * 否则同一个人在聊天里叫「玩家77」、在邀请列表里叫「用户77」。默认与包一致:`玩家{userId}`。
     */
    fallbackDisplayName?: (userId: string) => string;
}
export declare function createIdentityBridge(zh: Zhanghao, opts?: IdentityBridgeOptions): IdentityBridge;