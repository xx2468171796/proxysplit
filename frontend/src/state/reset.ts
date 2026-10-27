// 清除与重置中心的状态：清单（带预览数量）、正在执行的项、执行后刷新受影响的数据。
import { type ResetCenter, type ResetReport, resetApi } from "../api/reset";
import { createStore } from "../shared/store";
import { reloadData } from "./data";
import { refreshStatus } from "./runtime";

export type ResetState = { center: ResetCenter | null; busy: string; loadError: string };

export const resetState = createStore<ResetState>({ center: null, busy: "", loadError: "" });

export async function loadResetCenter(): Promise<void> {
  try {
    resetState.set({ center: await resetApi.center(), loadError: "" });
  } catch (e) {
    resetState.set({ loadError: `读取清除项失败：${String(e)}` });
  }
}

/** 一句话总结执行结果（失败的逐项列出原因）。 */
export function summarize(r: ResetReport): string {
  if (r.failed === 0) {
    const one = r.results.length === 1 ? r.results[0] : undefined;
    return one ? `${one.title}：${one.message || "已完成"}` : `已完成 ${r.ok} 项`;
  }
  const bad = r.results.filter((x) => !x.ok).map((x) => `${x.title}失败：${x.message}`);
  return bad.join("；");
}

/** 执行若干项；busy 记执行中的 key（单项 = 项 id，批量 = 自定义 key）。 */
export async function runReset(key: string, ids: string[], confirm = ""): Promise<ResetReport> {
  resetState.set({ busy: key });
  try {
    const report = await resetApi.run(ids, confirm);
    await Promise.all([reloadData(), refreshStatus(), loadResetCenter()]);
    return report;
  } finally {
    resetState.set({ busy: "" });
  }
}

export async function undoLastReset(): Promise<string> {
  resetState.set({ busy: "undo" });
  try {
    const err = await resetApi.undo();
    await Promise.all([reloadData(), refreshStatus(), loadResetCenter()]);
    return err ? `撤销失败：${err}` : "已撤销上一次重置，配置已恢复";
  } finally {
    resetState.set({ busy: "" });
  }
}
