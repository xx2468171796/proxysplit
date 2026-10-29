/**
 * KV key 布局的**唯一事实源**。
 *
 * 为什么非要单独一个文件:key 一旦散在 service 各处手拼,改前缀/改结构时漏掉一处不会报错,
 * 表现是「吊销了但那台还能用」这类查起来极贵的 bug。同理 —— 深圳那台 Redis 多站共用,
 * prefix 必须各站不同,否则 A 站改密会把 B 站同 id 的玩家踢下线。
 */
export function keys(prefix) {
    const base = `${prefix}:zh`;
    return {
        refresh: (jti) => `${base}:refresh:${jti}`,
        sessions: (userId) => `${base}:sessions:${userId}`,
        pwdver: (userId) => `${base}:pwdver:${userId}`,
        reqid: (requestId) => `${base}:reqid:${requestId}`,
    };
}
