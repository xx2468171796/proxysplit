// 应用生命周期：首屏快照、Go 事件、定时轮询、切回前台刷新。只在根组件调用一次。
import { useEffect } from "react";
import { onBackendEvent } from "../api/backend";
import type { AppUpdateStatus, BootstrapState } from "../api/types";
import { license, loadCommerce, refreshLicense } from "../state/account";
import { awaitAutoLogin } from "../state/account-sso";
import { refreshProcesses } from "../state/app-rules";
import { applyBootstrap, data, loadBootstrap, refreshClashMode, reloadData } from "../state/data";
import { refreshExit, refreshLink } from "../state/link";
import { refreshCustomRules, refreshRuleSets } from "../state/routing";
import { pushLog, refreshConns, refreshCoreVersion, refreshHealth, refreshStatus } from "../state/runtime";
import { loadSystem, refreshAccel } from "../state/system";
import {
  checkAppUpdate,
  loadAppVersion,
  receiveAutoUpdate,
  receiveAutoUpdateFailed,
  receiveUpdateInfo,
} from "../state/update";
import { openSettings } from "./nav";

type Say = (text: string | undefined) => void;
const BOOTSTRAP_EVENT = "proxysplit:bootstrap";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

declare global {
  interface Window {
    __PROXYSPLIT_BOOTSTRAP__?: BootstrapState;
  }
}

/** 先用 Go 在 OnDomReady 写进 window 的快照；没有就等 GetBootstrapState（最多 12 秒），再不行后台每 2 秒重试。 */
async function bootstrapWithRetry(signal: { stopped: boolean }): Promise<void> {
  applyBootstrap(window.__PROXYSPLIT_BOOTSTRAP__);
  for (let i = 0; i < 120 && !data.get().loaded && !signal.stopped; i++) {
    if (await loadBootstrap()) return;
    await wait(100);
  }
  while (!data.get().loaded && !signal.stopped) {
    await wait(2000);
    await loadBootstrap();
  }
}

/** 首屏之后的次要数据，并行取。 */
async function loadSecondary(say: Say): Promise<void> {
  void awaitAutoLogin().then((r) => say(r.err || r.notice));
  await Promise.all([
    // 快照里的授权可能早于 Go 端会话校验完成，这里再取一次最新的。
    refreshLicense(),
    refreshCoreVersion(),
    refreshClashMode(),
    loadAppVersion(),
    loadSystem(),
    refreshProcesses(),
    refreshHealth(),
    refreshRuleSets(),
    refreshCustomRules(),
    refreshAccel(),
  ]);
  await checkAppUpdate(true);
  await loadCommerce();
  const s = license.get().status;
  if (!license.get().membershipPrompted && s.signedIn && (!s.authenticated || s.planCode === "trial")) {
    license.set({ membershipOpen: true, membershipPrompted: true });
  }
}

function subscribeEvents(say: Say): Array<() => void> {
  return [
    onBackendEvent<string>("log", (line) => {
      pushLog(line);
      if (line.startsWith("[core] 已安装内核") || line.includes("新内核启动失败")) void refreshCoreVersion();
    }),
    onBackendEvent<AppUpdateStatus>("app-update", receiveUpdateInfo),
    onBackendEvent<AppUpdateStatus>("app-update-auto", (v) => say(receiveAutoUpdate(v))),
    onBackendEvent<string>("app-update-failed", (m) => say(receiveAutoUpdateFailed(m))),
    onBackendEvent<string>("open-settings", (id) => openSettings(id === "reset" ? "reset" : "general")), // 托盘「清除与重置…」
    onBackendEvent<string>("license-expired", (message) => {
      say(`会员授权已停止：${message}`);
      void Promise.all([refreshLicense(), refreshStatus()]).then(loadCommerce);
    }),
    // 后台改密 / 发会员 / 暂停账号等由看门狗每分钟推送，界面跟着刷新。
    onBackendEvent("license-changed", () => void onLicenseChanged(say)),
  ];
}

async function onLicenseChanged(say: Say): Promise<void> {
  const before = license.get().status.plan;
  await refreshLicense();
  await loadCommerce();
  const plan = license.get().status.plan;
  if (plan && plan !== before) say(`会员权益已更新：${plan}`);
}

/** 每秒：运行状态 + 分流健康（日志页再加实时连接）；3 秒：Claude 加速；1 分钟：套餐；1 小时：检查更新（有新版即强制升级）。 */
function startTimers(isLogsPage: () => boolean, isOverview: () => boolean): Array<ReturnType<typeof setInterval>> {
  return [
    // admin-ui-audit-ignore short-poll: 桌面客户端读本机 Go 后端（Wails 绑定）的运行状态，不是服务器业务数据，没有推送通道
    setInterval(() => {
      void refreshStatus();
      void refreshHealth();
      void refreshLink();
      if (isLogsPage()) void refreshConns();
      if (isOverview()) void refreshExit();
    }, 1000),
    // admin-ui-audit-ignore short-poll: 桌面客户端读本机 Go 后端（Wails 绑定）的运行状态，不是服务器业务数据，没有推送通道
    setInterval(() => void refreshAccel(), 3000),
    setInterval(() => void loadCommerce(), 60_000),
    setInterval(() => void checkAppUpdate(true), 3600_000),
  ];
}

export function useAppLifecycle(
  say: Say,
  isLogsPage: () => boolean,
  onNetBlocked: (msg: string) => void,
  isOverview: () => boolean,
): void {
  useEffect(() => {
    const signal = { stopped: false };
    const onBootstrap = (e: Event) => applyBootstrap((e as CustomEvent<BootstrapState>).detail);
    window.addEventListener(BOOTSTRAP_EVENT, onBootstrap);
    const offs = [...subscribeEvents(say), onBackendEvent<string>("net-blocked", onNetBlocked)];
    void bootstrapWithRetry(signal).then(() => loadSecondary(say));
    const timers = startTimers(isLogsPage, isOverview);
    // 切回前台：重读数据和授权（后台刚改过密码 / 发过会员时立刻是最新状态）。
    const onFocus = () => void reloadData();
    const onVisible = () => {
      if (document.visibilityState === "visible") void Promise.all([reloadData(), refreshLicense()]);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      signal.stopped = true;
      window.removeEventListener(BOOTSTRAP_EVENT, onBootstrap);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      for (const off of offs) off();
      for (const t of timers) clearInterval(t);
    };
  }, [say, isLogsPage, onNetBlocked, isOverview]);
}
