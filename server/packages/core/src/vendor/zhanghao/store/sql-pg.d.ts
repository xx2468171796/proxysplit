/**
 * 通用 PostgreSQL 参考实现:**不绑 ORM**,只要宿主能给一个 `query(text, params)`
 * (node-postgres 的 Pool/Client、postgres.js 包一层、Prisma 的 `$queryRawUnsafe` 包一层都行)。
 * Drizzle 宿主用 store/drizzle-pg;其余 PG 宿主用这个,省得自己实现 15 个方法。
 *
 * 与 drizzle 版同样的三条不能先查后写(理由见 store/drizzle-pg.ts 头注释):
 *   insertUserIfAbsent / updateIdentifierIfFree / insertAdminActionIfAbsent
 * 分别靠 `on conflict do nothing returning` 与 23505 捕获吃并发。
 *
 * 用户 id 列既可以是 text 也可以是 bigint:出入参都是字符串,PG 会按列类型自己转
 * (所以多数宿主不用传 userIdCodec;列型特殊时才传)。
 * `tx` 传一个同样有 `query` 的事务句柄(pg 的 PoolClient 在 BEGIN 之后),传了就用它。
 *
 * 表名可改(`tableNames`),列名**不可改**(与 sql/schema.sql 一致)。
 * 所有用户输入一律走 $n 参数,SQL 文本里只拼**校验过的表名**。
 */
import type { ZhanghaoStore } from "./types.ts";
export interface SqlQueryable {
    query(text: string, params?: unknown[]): Promise<{
        rows: any[];
    }>;
}
export interface UserIdCodec {
    toDb: (userId: string) => unknown;
    fromDb: (value: unknown) => string;
}
export interface SqlPgZhanghaoStoreOptions {
    /** 根查询器(连接池) */
    query: SqlQueryable["query"];
    /** 表名(默认 zh_users / zh_admin_actions / zh_beta_codes / zh_registration_days;后两张是注册管控用的,不用可不建) */
    tableNames?: Partial<{
        users: string;
        adminActions: string;
        betaCodes: string;
        registrationDays: string;
    }>;
    /** 出入参编解码;默认原样传字符串交给 PG 转型 */
    userIdCodec?: UserIdCodec;
}
export declare function createSqlPgZhanghaoStore(options: SqlPgZhanghaoStoreOptions): ZhanghaoStore;