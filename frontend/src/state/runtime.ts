// 运行时状态：内核 / 分流引擎状态、上下行速率、分流健康、实时连接、日志。每秒轮询，不落盘。
import { api } from "../api/backend";
import type { Conn, Health, Status } from "../api/types";
import { stripAnsi } from "../shared/format";
import { createStore } from "../shared/store";

type RecentLog = { time: string; level: "INFO" | "WARN" | "ERROR"; msg: string };

export type RuntimeState = {
  status: Status | null;
  health: Health;
  downRate: number;
  upRate: number;
  conns: Conn[];
  logs: string[];
  /** 收到过的日志总行数：logs[i] 的稳定编号 = logSeq - logs.length + i（日志列表按编号跟踪新行）。 */
  logSeq: number;
  recent: RecentLog[];
  busy: boolean;
  coreVersion: string;
};

export const runtime = createStore<RuntimeState>({
  status: null,
  health: { running: false, capturing: false, capturedPkts: 0, warning: "", lines: [] },
  downRate: 0,
  upRate: 0,
  conns: [],
  logs: [],
  logSeq: 0,
  recent: [],
  busy: false,
  coreVersion: "",
});

export const isRunning = (s: Status | null): boolean => !!s && (s.coreRunning || s.engineRunning);

// 速率由两次累计字节差算出；内核重启后计数归零，把回退当作新基线而不是负值。
let prev = { down: 0, up: 0, t: 0 };

export async function refreshStatus(): Promise<void> {
  let status: Status;
  try {
    status = await api.status();
  } catch {
    return;
  }
  const s = status?.stats;
  if (!s?.running) {
    prev = { down: 0, up: 0, t: 0 };
    runtime.set({ status, downRate: 0, upRate: 0 });
    return;
  }
  const now = Date.now();
  let rates = {};
  if (prev.t) {
    const dt = (now - prev.t) / 1000;
    if (dt > 0) {
      rates = {
        downRate: s.downBytes >= prev.down ? (s.downBytes - prev.down) / dt : 0,
        upRate: s.upBytes >= prev.up ? (s.upBytes - prev.up) / dt : 0,
      };
    }
  }
  prev = { down: s.downBytes, up: s.upBytes, t: now };
  runtime.set({ status, ...rates });
}

export async function refreshHealth(): Promise<void> {
  try {
    runtime.set({ health: await api.health() });
  } catch {
    /* 启动中，下一秒再取 */
  }
}

export async function refreshConns(): Promise<void> {
  runtime.set({ conns: await api.connections().catch(() => runtime.get().conns) });
}

export async function refreshCoreVersion(): Promise<void> {
  runtime.set({ coreVersion: (await api.coreVersion().catch(() => "")) || "未知" });
}

/** 收一行日志：原始日志保留最近 800 行，概览「最新日志」保留 8 条。 */
export function pushLog(raw: string): void {
  const line = stripAnsi(raw);
  const m = line.match(/\[(divert|core|engine|service|rule|ui|error)\]\s*(.*)/);
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((x) => String(x).padStart(2, "0")).join(":");
  const level: RecentLog["level"] = /error|fail|失败/i.test(line) ? "ERROR" : /warn|超时/i.test(line) ? "WARN" : "INFO";
  runtime.set((s) => ({
    logs: [...s.logs.slice(-800), line],
    logSeq: s.logSeq + 1,
    recent: [{ time, level, msg: m ? m[2] || line : line }, ...s.recent].slice(0, 8),
  }));
}

/** 清空日志，返回清掉的行（给「撤销」用）。 */
export function clearLogs(): string[] {
  const removed = runtime.get().logs;
  runtime.set({ logs: [] });
  return removed;
}

/** 撤销清空：把清掉的行接回到这期间新来的日志前面，仍只留最近 800 行。 */
export function restoreLogs(lines: string[]): void {
  runtime.set((s) => ({ logs: [...lines, ...s.logs].slice(-800) }));
}

const CAPTURE_NOTE_KEY = "ps-capture-note-shown";

/** 驱动回退说明：这台电脑上已经弹过同一句就返回空串。 */
export function onceCaptureNote(note: string): string {
  if (!note) return "";
  try {
    if (localStorage.getItem(CAPTURE_NOTE_KEY) === note) return "";
    localStorage.setItem(CAPTURE_NOTE_KEY, note);
  } catch {
    // 存不了就照常提示
  }
  return note;
}

/** 启动 / 停止代理。返回给用户看的错误（空串 = 成功）。 */
export async function toggleRun(): Promise<string> {
  if (runtime.get().busy) return "";
  runtime.set({ busy: true });
  try {
    if (isRunning(runtime.get().status)) {
      await api.stop();
      return "";
    }
    const err = await api.start();
    if (!err) {
      await refreshStatus();
      // 仅接管选中程序的驱动被拦、本次改用整机虚拟网卡时，Go 在状态里带一句说明。
      // 同一句只弹一次（客户反馈每次启动都弹，很烦）；Go 那边也记住了，之后不再重试驱动。
      const st = runtime.get().status as (Status & { captureNote?: string }) | null;
      return onceCaptureNote(st?.captureNote ?? "");
    }
    pushLog(`[error] ${err}`);
    // WinDivert errors mention 管理员 too, but rights are rarely the cause there.
    return /admin|管理员|tun|wintun/i.test(err) && !/WinDivert/i.test(err)
      ? "启动失败：请关闭后「右键 → 以管理员身份运行」"
      : `启动失败：${err}`;
  } catch (e) {
    return `操作失败：${String(e)}`;
  } finally {
    await refreshStatus();
    runtime.set({ busy: false });
  }
}

export async function restartCore(): Promise<string> {
  if (runtime.get().busy) return "";
  runtime.set({ busy: true });
  try {
    const err = await api.restart();
    if (err) pushLog(`[error] ${err}`);
    return err ? `重启失败：${err}` : "";
  } finally {
    await refreshStatus();
    runtime.set({ busy: false });
  }
}
