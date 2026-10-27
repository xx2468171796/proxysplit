// 设置页的系统项：开机自启、日志级别、局域网 IP、AI 控制接口、Claude Code 加速、内核更新、配置导出 / 导入（重置见 state/reset.ts）。
import { api } from "../api/backend";
import type { AccelState, AIControlInfo } from "../api/types";
import { createStore } from "../shared/store";
import { reloadData, saveSettings } from "./data";
import { runtime } from "./runtime";

export type SystemState = {
  autostart: boolean;
  logLevel: string;
  lanIP: string;
  ai: AIControlInfo;
  accel: AccelState | null;
  accelBusy: boolean;
  coreUpdating: boolean;
};

export const system = createStore<SystemState>({
  autostart: false,
  logLevel: "info",
  lanIP: "",
  ai: { url: "http://127.0.0.1:18088", token: "", prompt: "", mcpConfig: "", running: false },
  accel: null,
  accelBusy: false,
  coreUpdating: false,
});

export async function loadSystem(): Promise<void> {
  const cur = system.get();
  const [autostart, logLevel, lanIP, ai] = await Promise.all([
    api.autostart().catch(() => cur.autostart),
    api.logLevel().catch(() => cur.logLevel),
    api.lanIP().catch(() => ""),
    api.aiControlInfo().catch(() => cur.ai),
  ]);
  system.set({ autostart, logLevel: logLevel || "info", lanIP, ai: ai ?? cur.ai });
}

export async function setAutostart(on: boolean): Promise<string> {
  const err = await api.setAutostart(on);
  system.set({ autostart: await api.autostart().catch(() => on) });
  return err;
}

export async function setLogLevel(level: string): Promise<string> {
  system.set({ logLevel: level });
  return api.setLogLevel(level);
}

// Claude Code 加速（docs/Claude加速-网关切换.md）：状态每 3 秒刷新。
export async function refreshAccel(): Promise<void> {
  try {
    system.set({ accel: await api.claudeAccel() });
  } catch {
    /* 启动中 */
  }
}

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function setAccelMode(mode: "official" | "encode" | "auto"): Promise<string> {
  system.set({ accelBusy: true });
  const err = await api.setClaudeAccelMode(mode);
  await later(1500);
  await refreshAccel();
  system.set({ accelBusy: false });
  return err;
}

/** 加速总开关 / 自动切换开关（设置里存的是「关」）。 */
export async function setAccelOption(field: "claudeAccelOff" | "claudeAccelAutoOff", on: boolean): Promise<string> {
  const err = await saveSettings({ [field]: !on });
  setTimeout(() => void refreshAccel(), 1500);
  return err;
}

export function accelSavedPercent(st: AccelState | null): number {
  const req = st?.stats?.reqBytes || 0;
  const sent = st?.stats?.frameBytes || 0;
  return req > 0 ? Math.max(0, Math.round((1 - sent / req) * 100)) : 0;
}

/** 立即检查 POWER云 标准内核。 */
export async function updateCore(): Promise<string> {
  if (system.get().coreUpdating) return "";
  system.set({ coreUpdating: true });
  try {
    const res = await api.updateCore();
    if (!res || res.startsWith("ERR:")) return `失败：${res ? res.slice(4) : "内核更新未返回版本"}`;
    if (res === runtime.get().coreVersion) return `已是最新 v${res}`;
    runtime.set({ coreVersion: res });
    return `已更新到 v${res}${runtime.get().status?.coreRunning ? "（已自动重启内核）" : "（下次启动生效）"}`;
  } catch (e) {
    return `失败：${String(e)}`;
  } finally {
    system.set({ coreUpdating: false });
  }
}

export async function exportConfig(): Promise<string> {
  const err = await api.exportConfig();
  return err ? `导出失败：${err}` : "已导出配置备份";
}

export async function importConfig(): Promise<string> {
  const err = await api.importConfig();
  if (err) return `导入失败：${err}`;
  await reloadData();
  return "已导入配置备份";
}

/** 复制到剪贴板：优先走 Go（WebView2 剪贴板权限偶尔不可用）。 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (!(await api.copyToClipboard(text))) return true;
    throw new Error("clipboard");
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
