/**
 * 零依赖 HS256 JWT 签发与验签(node:crypto)。
 *
 * 为什么不用 jsonwebtoken:本包承诺零运行时依赖,而我们只需要 HS256 这一条路径;
 * 整个实现不到 100 行,且能把「密钥轮换」做成一等入参 —— 验签依次试 [current, ...previous],
 * 这样换密钥时**在途的 token 不会集体失效**(否则换一次密钥 = 全站被登出)。
 *
 * 三条纪律:
 *   - 只接受 alg=HS256:不认 header 里写的别的算法,更不认 alg=none(经典绕过)。
 *   - 签名比较走 timingSafeEqual。
 *   - 过期与非法是**两个**错误码:客户端据此决定「去续签」还是「回登录页」。
 */
export interface JwtPayload {
    [key: string]: unknown;
    /** 签发时间(秒) */
    iat?: number;
    /** 过期时间(秒) */
    exp?: number;
}
export interface SignOptions {
    /** 有效期秒;不传则不写 exp(本包总是传) */
    expSec?: number;
    /** 注入时钟,测试用 */
    now?: Date;
}
/** 签发。payload 里的 iat/exp 由本函数写,调用方传的同名字段会被覆盖 */
export declare function signJwt(payload: JwtPayload, secret: string, options?: SignOptions): string;
export interface VerifyOptions {
    now?: Date;
    /** 容忍的时钟偏移秒(多实例机器时间不完全一致),默认 0 */
    clockToleranceSec?: number;
}
/**
 * 验签 + 验过期。secrets 传数组时依次试(轮换期);全部不匹配才判非法。
 * 注意顺序:**先验签名再看 exp** —— 一张伪造的过期 token 应该报「非法」而不是「过期」。
 */
export declare function verifyJwt(token: string, secrets: string | string[], options?: VerifyOptions): JwtPayload;
/** 不验签只读载荷 —— 只给日志/调试用,**任何鉴权判断都不许用它** */
export declare function decodeJwtUnsafe(token: string): JwtPayload | null;