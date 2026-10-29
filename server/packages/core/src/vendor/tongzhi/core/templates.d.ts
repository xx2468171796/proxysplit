/**
 * 自带模板:后台「用模板」一键填表,tzctl `templates` 也返回这份。
 * 宿主可 `createTongzhi({ templates: [...] })` 追加或覆盖(按 key 合并)。
 * `{{var}}` 占位符由 applyTemplate 用 vars 填,没给的保留原样让人看见。
 */
import type { NoticeInput } from "../types.ts";
export interface NoticeTemplate {
    key: string;
    name: string;
    description: string;
    /** 变量名列表(给表单画输入框 / 给 AI 看) */
    vars: string[];
    input: NoticeInput;
}
export declare const BUILTIN_TEMPLATES: NoticeTemplate[];
export declare function applyTemplate(tpl: NoticeTemplate, vars: Record<string, string>): NoticeInput;
export declare function mergeTemplates(extra: NoticeTemplate[] | undefined): NoticeTemplate[];