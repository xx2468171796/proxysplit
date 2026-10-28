// 配置与同步：同步状态、云端配置列表、待确认的导入（本地文件 / 云端配置 / 别人的分享码共用一个预览确认框）。
import { onBackendEvent } from "../api/backend";
import { syncApi } from "../api/sync";
import type { ConfigPreview, ConfigProfile, ConfigSection, ImportPreview, SyncStatus } from "../api/types-account";
import { createStore } from "../shared/store";
import { reloadData } from "./data";

/** 预览从哪来：决定确认框的标题和说明 */
export type ImportSource = "file" | "profile" | "share";

export type SyncState = {
  status: SyncStatus | null;
  profiles: ConfigProfile[];
  quota: number;
  used: number;
  profilesError: string;
  profilesLoading: boolean;
  pending: { source: ImportSource; preview: ConfigPreview } | null;
};

export const configSync = createStore<SyncState>({
  status: null,
  profiles: [],
  quota: 0,
  used: 0,
  profilesError: "",
  profilesLoading: false,
  pending: null,
});

export const SECTION_LABELS: Record<ConfigSection, string> = {
  nodes: "节点",
  subscriptions: "订阅",
  rules: "分流规则与应用",
  proxyPorts: "端口代理",
  settings: "软件设置",
};

export async function loadSyncStatus(): Promise<void> {
  try {
    configSync.set({ status: await syncApi.syncStatus() });
  } catch {
    /* 启动中 */
  }
}

let lastVersion = -1;
/** Go 推送的同步状态；云端拉下来新配置（版本变了）时重读界面数据。 */
export function watchSyncEvents(): () => void {
  return onBackendEvent<SyncStatus>("configsync", (st) => {
    configSync.set({ status: st });
    if (lastVersion >= 0 && st.lastVersion !== lastVersion && !st.busy) void reloadData();
    lastVersion = st.lastVersion;
  });
}

export async function loadProfiles(): Promise<void> {
  configSync.set({ profilesLoading: true });
  const r = await syncApi.profiles();
  configSync.set({
    profilesLoading: false,
    profiles: r.items,
    quota: r.quota,
    used: r.used,
    profilesError: r.err ?? "",
  });
}

function stage(source: ImportSource, r: ImportPreview): string {
  if (r.canceled) return "";
  if (r.err || !r.preview) return r.err || "没读到配置内容";
  configSync.set({ pending: { source, preview: { ...r.preview, sections: r.preview.sections ?? [] } } });
  return "";
}

export async function pickImportFile(): Promise<string> {
  return stage("file", await syncApi.importConfig());
}

export async function previewProfile(id: string, password = ""): Promise<string> {
  return stage("profile", await syncApi.previewProfile(id, password));
}

export async function previewShared(code: string, password: string): Promise<string> {
  return stage("share", await syncApi.previewShared(code.trim().toUpperCase(), password));
}

export function cancelImport(): void {
  configSync.set({ pending: null });
  void syncApi.cancelImport();
}

/** 确认导入勾选的部分；成功后重读界面数据。返回错误文字，'' = 成功。 */
export async function confirmImport(sections: ConfigSection[]): Promise<string> {
  if (!sections.length) return "请至少勾选一项要恢复的内容";
  const err = await syncApi.confirmImport(sections);
  if (err) return err;
  configSync.set({ pending: null });
  await Promise.all([reloadData(), loadSyncStatus()]);
  return "";
}

export async function undoImport(): Promise<string> {
  const err = await syncApi.undoImport();
  if (err) return `撤销失败：${err}`;
  await Promise.all([reloadData(), loadSyncStatus()]);
  return "已恢复到导入前的配置";
}

export async function exportConfig(): Promise<string> {
  const err = await syncApi.exportConfig();
  return err ? `导出失败：${err}` : "";
}

export async function syncNow(): Promise<string> {
  const err = await syncApi.syncNow();
  await loadSyncStatus();
  return err ? `同步失败：${err}` : "";
}

export async function setSyncEnabled(on: boolean): Promise<string> {
  const err = await syncApi.setSyncEnabled(on);
  await loadSyncStatus();
  return err;
}

export async function resolveConflict(choice: "cloud" | "local"): Promise<string> {
  const err = await syncApi.resolveSyncConflict(choice);
  await Promise.all([loadSyncStatus(), choice === "cloud" ? reloadData() : Promise.resolve()]);
  return err;
}

/** 云端配置的增删改：成功后重读列表。 */
export async function profileAction(action: () => Promise<string>): Promise<string> {
  const err = await action();
  if (!err) await loadProfiles();
  return err;
}
