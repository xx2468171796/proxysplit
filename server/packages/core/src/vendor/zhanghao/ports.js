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
export {};
