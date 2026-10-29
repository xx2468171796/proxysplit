import type { Notice } from "../types.ts";
import type { TongzhiStore } from "./types.ts";
export interface SqlQueryable {
    query(text: string, values?: unknown[]): Promise<{
        rows: any[];
    }>;
}
export interface SqlPgTongzhiStoreOptions {
    db: SqlQueryable;
    /** 表名(默认 notice / notice_delivery / notice_receipt);可带 schema 前缀 */
    tables?: Partial<{
        notices: string;
        deliveries: string;
        receipts: string;
    }>;
    /** 读回的 jsonb(actions / meta / payload)不合规而回落默认值时调用;不给就静默回落。建议接到宿主日志 */
    onWarn?: SqlPgWarn;
}
/** 存储层告警钩子:message 是中文说明,detail 只含通知 id 与字段名,不含内容 */
export type SqlPgWarn = (message: string, detail: {
    noticeId: string;
    field: string;
}) => void;
export declare function mapNoticeRow(r: any, warn?: SqlPgWarn): Notice;
export declare function createSqlPgTongzhiStore(options: SqlPgTongzhiStoreOptions): TongzhiStore;