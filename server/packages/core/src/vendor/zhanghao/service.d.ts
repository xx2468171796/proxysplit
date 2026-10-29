/**
 * zhanghao 领域内核:注册 / 登录 / 会话 / 本人资料 / 公开投影 / 后台用户管理的全部业务规则。
 *
 * 包管什么、不管什么:
 *   - 标识符归一化、密码闸门与哈希、唯一性冲突翻译、token 签发与轮换、会话吊销、
 *     防枚举、后台幂等审计 —— **包**。
 *   - 谁有权调后台接口、短信/邮箱验证码、钱包与注册礼包、通知 —— **宿主**(afterCreate / onEvent)。
 *
 * 几条容易写错、写错了还不报错的地方,都在下面对应位置写了原因:
 *   1. 唯一性只信 store 的约束返回值,不先查再写(并发注册会放进两个同名号)。
 *   2. 「不存在」与「密码错」必须走同一条出口(同错误码同文案),且两条路都要 record 失败 ——
 *      否则状态码/耗时差异本身就是账号枚举预言机。
 *   3. KV 写在 PG 写成功之后:token/会话不进宿主事务(事务回滚不会回滚 Redis)。
 *   4. `auth:sessions:{userId}` 是集合不是单值,单值只记得最后登录那一台。
 */
import type { Zhanghao, ZhanghaoOptions } from "./service-contract.ts";
import { type UserRole } from "./types.ts";
export declare function createZhanghao(opts: ZhanghaoOptions): Zhanghao;
export type { UserRole };