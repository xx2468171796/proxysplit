/**
 * ILIKE 模式转义:用户输入里的 `%` `_` `\` 在 LIKE 里是通配 / 转义符,
 * 不转义的话搜「50%」会匹配全部、搜「a_b」会匹配 aXb。配合 SQL 里的 `escape '\'` 使用
 * (PG 默认转义符本来就是 `\`,显式写出来是为了不依赖 standard_conforming_strings 之类的设置)。
 */
export declare function escapeLike(value: string): string;
/** 「包含」模式:`%<转义后>%` */
export declare function likeContains(value: string): string;
/** 「前缀」模式:`<转义后>%` */
export declare function likePrefix(value: string): string;
/** 拼在 `ilike $n` 后面的转义子句(常量文本,不含任何用户输入) */
export declare const LIKE_ESCAPE: string;