// 订阅：添加、编辑、更新、自动更新开关、删除。每行的进行中状态放在 pending 里。
import { api } from "../api/backend";
import type { SubOptions } from "../api/types";
import { createStore } from "../shared/store";
import { data, refreshNodes, refreshSubs } from "./data";

export const subTasks = createStore<{ pending: Record<string, "update" | "save"> }>({ pending: {} });

function setPending(id: string, kind?: "update" | "save"): void {
  subTasks.set((s) => {
    const pending = { ...s.pending };
    if (kind) pending[id] = kind;
    else delete pending[id];
    return { pending };
  });
}

export async function addSub(name: string, url: string, auto: boolean): Promise<string> {
  const n = name.trim();
  const u = url.trim();
  if (!n || !u) return "请填写订阅名称和地址";
  const err = await api.addSub(n, u, auto);
  if (err) return `添加失败：${err}`;
  await Promise.all([refreshSubs(), refreshNodes()]);
  return "";
}

/** 改名 / 改地址后 Go 端会重新拉取一次。 */
export async function editSub(id: string, name: string, url: string): Promise<string> {
  if (!name.trim() || !url.trim()) return "请填写订阅名称和地址";
  setPending(id, "save");
  try {
    const err = await api.editSub(id, name.trim(), url.trim());
    if (err) return `保存失败：${err}`;
    await Promise.all([refreshSubs(), refreshNodes()]);
    return "";
  } finally {
    setPending(id);
  }
}

export async function updateSub(id: string): Promise<string> {
  if (subTasks.get().pending[id]) return "";
  setPending(id, "update");
  try {
    const err = await api.updateSub(id);
    await Promise.all([refreshSubs(), refreshNodes()]);
    return err ? `更新失败：${err}` : "";
  } finally {
    setPending(id);
  }
}

/** 逐个更新全部订阅，返回失败的条数。 */
export async function updateAllSubs(): Promise<number> {
  let failed = 0;
  for (const s of data.get().subs) if (await updateSub(s.id)) failed++;
  return failed;
}

export async function setSubAutoUpdate(id: string, on: boolean): Promise<void> {
  data.set((s) => ({ subs: s.subs.map((x) => (x.id === id ? { ...x, autoUpdate: on } : x)) }));
  await api.setSubAutoUpdate(id, on);
}

/** Go 端会连带删掉该订阅的节点，所以节点列表也要刷新。 */
export async function removeSub(id: string): Promise<void> {
  await api.removeSub(id);
  await Promise.all([refreshSubs(), refreshNodes()]);
}

/** 保存订阅高级选项；Go 端先按新选项拉取一次，成功才保存。 */
export async function setSubOptions(id: string, o: SubOptions): Promise<string> {
  setPending(id, "save");
  try {
    const err = await api.setSubOptions(id, o);
    if (err) return `保存失败：${err}`;
    await Promise.all([refreshSubs(), refreshNodes()]);
    return "";
  } finally {
    setPending(id);
  }
}
