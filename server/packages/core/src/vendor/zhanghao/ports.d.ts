/**
 * 宿主注入的端口。包零运行时依赖,所有会碰外部世界的事都从这里进来:
 *   - KvLike:会话/锁定/幂等等短生命周期状态(生产必须是 Redis;多 worker 下内存实现不跨进程)
 *   - PasswordHasher:默认实现在 password.ts(node:crypto scrypt);宿主可换 argon2
 *   - Clock:测试注入时钟
 *   - LoginGuard:可选,接 yanzheng 的 createLoginGuard(撞库/爆破递进锁定);不接就没有锁定
 *
 * 注意:和 yanzheng 的 RedisLike **不是**同一形状(set 第三个参数这里是 ttlSec 数字、那边是 {EX};del 这里不返回、那边返回个数;
 * 这里还要集合操作)——原注释说「刻意相同、一个适配器两包共用」是错的(2026-10-24 用 jichu 一致性用例核对时发现)。
 * jichu 的 KvCore 覆盖 get / set / setNx / expire,集合操作要宿主另补。
 */
export interface KvLike {
    get(key: string): Promise<string | null>;
    /** ttlSec 可选;传了必须原子设置过期 */
    set(key: string, value: string, ttlSec?: number): Promise<void>;
    /** 只在不存在时写;成功返 true(幂等锚、单飞锁用它) */
    setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
    del(key: string): Promise<void>;
    /** 集合:一个用户名下全部活跃 refresh jti */
    sadd(key: string, member: string): Promise<void>;
    srem(key: string, member: string): Promise<void>;
    smembers(key: string): Promise<string[]>;
    expire(key: string, ttlSec: number): Promise<void>;
}
export interface PasswordHasher {
    hash(password: string): Promise<string>;
    verify(password: string, hash: string): Promise<boolean>;
    /** 哈希格式是不是本实现产出的(换算法平滑迁移用:旧格式验证通过后重哈希) */
    owns?(hash: string): boolean;
}
export type Clock = () => Date;
/**
 * 登录防护端口(可选)。形状**逐字对齐 yanzheng `createLoginGuard` 返回值**,宿主直接把实例传进来;
 * 不传 = 无锁定。account 由本包按「u:<userId>」(存在)/「n:<登录名>」(不存在)规范化后传入 ——
 * 不存在的号也必须计数,否则「不存在的号永远不会被锁」本身就是枚举预言机。
 */
export interface LoginGuard {
    check(account: string, ip?: string): Promise<{
        allowed: boolean;
        retryAfterSec?: number;
        requireCaptcha?: boolean;
        degraded?: boolean;
        tier?: number;
        failCount?: number;
    }>;
    record(account: string, success: boolean, ip?: string): Promise<void>;
    reset(account: string): Promise<void>;
    inspect(account: string): Promise<{
        failCount: number;
        lockedForSec: number;
        tier: number;
        tierCount: number;
    }>;
}
/** 单设备登录端口(可选):形状对齐 yanzheng/session/single 的 bind / check / kickAll */
export interface SingleSession {
    bind(userId: string, sid: string, meta?: {
        deviceId?: string | null;
        ua?: string | null;
        ip?: string | null;
        label?: string | null;
    }): Promise<unknown>;
    check(userId: string, sid: string | null | undefined): Promise<{
        ok: boolean;
        degraded?: boolean;
        message?: string;
    }>;
    kickAll(userId: string, message?: string): Promise<unknown>;
}