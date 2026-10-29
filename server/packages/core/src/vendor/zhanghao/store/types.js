/**
 * 存储契约。包不假设 ORM,但**假设两张表长成 sql/schema.sql 那样**(users / admin_actions)。
 * 用 Drizzle + PG 的直接拿 store/drizzle-pg;原生 SQL(pg / postgres.js / Prisma $queryRaw)拿 store/sql-pg。
 *
 * 自己实现时有三处**不能用 ORM 的天真写法**:
 *   - insertUserIfAbsent:唯一性只信数据库约束(username / phone / email 三个部分唯一索引),
 *     撞约束返回 { conflict: "username" | "phone" | "email" }。「先查再插」在并发注册下会放进两个同名号。
 *   - updateIdentifierIfFree:改用户名/手机/邮箱同上,撞约束返回 false,不许先 select 再 update。
 *   - insertAdminActionIfAbsent:靠 requestId 唯一吃并发(on conflict do nothing + returning);
 *     返回 null = 这个 requestId 已执行过,service 据此回放不二次生效。
 *
 * `tx` 是宿主事务句柄(drizzle 的 tx 对象 / pg client),传了就在宿主事务里做。
 * 注册必须能带 tx:宿主要在同一事务里建钱包、发注册礼包(afterCreate)。
 */
export {};
