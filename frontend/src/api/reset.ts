// 清除与重置中心的后端适配（app_reset.go）：Go 返回值在这里用 Zod 校验，界面只拿干净的类型。
import { z } from "zod";
import * as W from "../../wailsjs/go/main/App.js";

const list = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((v) => v ?? []);

export const ResetItemSchema = z.object({
  id: z.string(),
  group: z.enum(["cache", "network", "config"]).catch("cache"),
  title: z.string(),
  effect: z.string().default(""),
  restarts: z.boolean().default(false),
  danger: z.enum(["safe", "caution", "danger"]).catch("caution"),
  lost: list(z.string()),
  kept: list(z.string()),
  confirm: z.string().default(""),
  backup: z.boolean().default(false),
  available: z.boolean().default(false),
  count: z.number().default(-1),
  countText: z.string().default(""),
});
export type ResetItem = z.infer<typeof ResetItemSchema>;

const ResetCenterSchema = z.object({
  items: list(ResetItemSchema),
  lastBackup: z.string().default(""),
  confirm: z.string().default("确认重置"),
});
export type ResetCenter = z.infer<typeof ResetCenterSchema>;

const ResetReportSchema = z.object({
  results: list(z.object({ id: z.string(), title: z.string(), ok: z.boolean(), message: z.string().default("") })),
  backup: z.string().default(""),
  ok: z.number().default(0),
  failed: z.number().default(0),
  ms: z.number().default(0),
});
export type ResetReport = z.infer<typeof ResetReportSchema>;

export const resetApi = {
  center: async (): Promise<ResetCenter> => ResetCenterSchema.parse(await W.GetResetCenter()),
  run: async (ids: string[], confirm = ""): Promise<ResetReport> =>
    ResetReportSchema.parse(await W.RunReset(ids, confirm)),
  undo: () => W.UndoReset(),
};
