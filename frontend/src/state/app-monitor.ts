// 逐应用监测与应用库：规则表每 2 秒取一次各应用的连接统计；应用库 = 内置模拟器 + 用户自定义（一个应用对应多个进程）。
import { api } from "../api/backend";
import type { AppStat, CatalogApp } from "../api/types";
import { createStore } from "../shared/store";
import { addRules, monitorKey } from "./app-rules";
import { data } from "./data";

export type MonitorState = {
  /** 小写进程名 → 统计 */
  stats: Record<string, AppStat>;
  catalog: CatalogApp[];
};

export const monitor = createStore<MonitorState>({ stats: {}, catalog: [] });

export const statKey = (name: string) => name.toLowerCase();

export async function refreshAppStats(): Promise<void> {
  const names = data.get().rules.map(monitorKey);
  if (!names.length) return;
  const list = await api.appStats(names).catch(() => null);
  if (!list) return;
  const stats: Record<string, AppStat> = {};
  for (const s of list) stats[statKey(s.process)] = s;
  monitor.set({ stats });
}

export async function refreshCatalog(): Promise<void> {
  const catalog = await api.appCatalog().catch(() => monitor.get().catalog);
  monitor.set({ catalog });
}

/** 保存自定义应用（整份）。返回错误文本，空串 = 成功。 */
export async function saveCustomApps(custom: CatalogApp[]): Promise<string> {
  const err = await api.setCustomApps(custom);
  if (!err) await refreshCatalog();
  return err;
}

export const customApps = (): CatalogApp[] => monitor.get().catalog.filter((a) => !a.builtin);

/** 把一个应用的全部进程加进应用规则（已有的跳过）。 */
export function addCatalogApp(app: CatalogApp, line: string): Promise<{ added: number; err: string }> {
  // 检测到安装目录就按目录加（目录下所有程序都走，换了进程名也能抓到）；没检测到才按已知进程名加
  const targets = app.dirs?.length ? app.dirs : app.processes;
  return addRules(targets.map((p) => ({ match: p, path: p, line, node: "", enabled: true })));
}

export const fetchAppDetail = (process: string) => api.appMonitorDetail(process);
export const resetAppStat = (process: string) => api.resetAppMonitor(process);
export const routeTest = (process: string, url: string) => api.appRouteTest(process, url);
