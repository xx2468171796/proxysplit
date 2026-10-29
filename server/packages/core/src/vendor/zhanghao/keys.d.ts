/**
 * KV key 布局的**唯一事实源**。
 *
 * 为什么非要单独一个文件:key 一旦散在 service 各处手拼,改前缀/改结构时漏掉一处不会报错,
 * 表现是「吊销了但那台还能用」这类查起来极贵的 bug。同理 —— 深圳那台 Redis 多站共用,
 * prefix 必须各站不同,否则 A 站改密会把 B 站同 id 的玩家踢下线。
 */
export interface ZhanghaoKeys {
    /** 一条 refresh 记录:JSON {userId, sid, status, exp} */
    refresh(jti: string): string;
    /** 某用户全部活跃 refresh jti 的集合。**集合不是单值** —— 单值只记得最后登录那一台 */
    sessions(userId: string): string;
    /** 密码版本 / 吊销水位(宿主要让 access 也能立即失效时用) */
    pwdver(userId: string): string;
    /** 幂等短锁,与 DB 的 requestId 唯一约束双保险 */
    reqid(requestId: string): string;
}
export declare function keys(prefix: string): ZhanghaoKeys;