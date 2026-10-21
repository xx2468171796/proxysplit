// 端口代理：每个端口是一条独立线路（自己的内核进程）。列表每 2 秒由页面轮询刷新；
// 写操作返回 Go 端的错误文本（空串 = 成功）。
import { api } from "../api/backend";
import type { PortDetail, PortMode, ProxyPort, ProxyPortStatus } from "../api/types";
import { createStore } from "../shared/store";

export type PortsState = {
  loaded: boolean;
  list: ProxyPortStatus[];
  /** 正在启停 / 删除的端口 id（开关置灰，防连点）。 */
  busy: string[];
};

export const ports = createStore<PortsState>({ loaded: false, list: [], busy: [] });

let inflight = false;

export async function refreshPorts(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    ports.set({ list: await api.proxyPorts(), loaded: true });
  } catch {
    /* 后端暂时取不到：保留上一次的列表，下个 2 秒再取 */
  } finally {
    inflight = false;
  }
}

const withBusy = async (id: string, run: () => Promise<string>): Promise<string> => {
  ports.set((s) => ({ busy: [...s.busy, id] }));
  try {
    return await run();
  } finally {
    await refreshPorts();
    ports.set((s) => ({ busy: s.busy.filter((b) => b !== id) }));
  }
};

/** 新建（id 为空）或保存一个端口。 */
export async function savePort(p: ProxyPort): Promise<string> {
  const err = await api.saveProxyPort(p);
  await refreshPorts();
  return err;
}

/** 批量新建：逐个保存，遇错即停。返回已建数量和第一个错误。 */
export async function createPorts(drafts: ProxyPort[]): Promise<{ created: number; err: string }> {
  let created = 0;
  for (const d of drafts) {
    const err = await api.saveProxyPort(d);
    if (err) {
      await refreshPorts();
      return { created, err: `「${d.name}」（端口 ${d.port}）：${err}` };
    }
    created++;
  }
  await refreshPorts();
  return { created, err: "" };
}

export const setPortEnabled = (id: string, on: boolean): Promise<string> =>
  withBusy(id, () => api.setProxyPortEnabled(id, on));

export const removePort = (id: string): Promise<string> =>
  withBusy(id, async () => {
    await api.deleteProxyPort(id);
    return "";
  });

/** 在线切换分流方式（不影响别的端口）：先改界面再调后端，失败由下一轮刷新还原。 */
export async function setPortMode(id: string, mode: PortMode): Promise<string> {
  ports.set((s) => ({ list: s.list.map((p) => (p.id === id ? { ...p, mode } : p)) }));
  const err = await api.setProxyPortMode(id, mode);
  await refreshPorts();
  return err;
}

export const fetchPortDetail = (id: string, client: string): Promise<PortDetail> => api.proxyPortDetail(id, client);
