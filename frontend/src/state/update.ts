// 软件自更新：Go 端自动检查并安装（签名 + SHA256 校验），界面显示进度；强制版本整屏拦住。
import { api } from "../api/backend";
import type { AppUpdateStatus } from "../api/types";
import { createStore } from "../shared/store";

export type UpdateState = {
  info: AppUpdateStatus;
  /** 正在向服务端问有没有新版本（设置页「检查更新」按钮转圈） */
  checking: boolean;
  /** 正在下载安装（强制升级框显示进度）。和 checking 分开：后台每小时的检查不能把安装中冲掉 */
  installing: boolean;
};

export const appUpdate = createStore<UpdateState>({
  info: { enabled: false, current: "dev", available: false },
  checking: false,
  installing: false,
});

export async function loadAppVersion(): Promise<void> {
  const current = await api.appVersion().catch(() => "dev");
  appUpdate.set((s) => ({ info: { ...s.info, current } }));
}

/** 手动检查时返回给用户的一句话；静默检查返回空串。 */
export async function checkAppUpdate(silent: boolean): Promise<string> {
  appUpdate.set({ checking: true });
  try {
    const info = await api.checkAppUpdate();
    appUpdate.set({ info });
    if (silent) return "";
    if (info.error) return info.error;
    if (info.available && info.release) return `发现新版本 v${info.release.version}`;
    if (!info.enabled) return "当前构建未启用正式更新服务";
    return `当前 v${info.current} 已是最新版本`;
  } catch (e) {
    return silent ? "" : `检查更新失败：${String(e)}`;
  } finally {
    appUpdate.set({ checking: false });
  }
}

/** 安装成功后软件会自动重启，所以成功时保持 installing。 */
export async function installAppUpdate(): Promise<string> {
  const { info, installing } = appUpdate.get();
  if (!info.release || installing) return "";
  appUpdate.set({ installing: true });
  try {
    const err = await api.installAppUpdate(info);
    if (!err) return `v${info.release.version} 已验证，软件即将自动重启完成升级`;
    appUpdate.set({ installing: false });
    return `升级失败：${err}`;
  } catch (e) {
    appUpdate.set({ installing: false });
    return `升级失败：${String(e)}`;
  }
}

export function receiveUpdateInfo(info: AppUpdateStatus | null): void {
  if (info) appUpdate.set({ info });
}

/** 后端开始自动安装：显示进度，只有失败才重新放开手动按钮。 */
export function receiveAutoUpdate(info: AppUpdateStatus | null): string {
  if (!info?.release) return "";
  appUpdate.set({ info, installing: true });
  return `正在自动升级到 v${info.release.version}，完成后自动重启`;
}

export function receiveAutoUpdateFailed(msg: string): string {
  appUpdate.set({ installing: false });
  return `自动升级失败：${msg}，可点「立即安全升级」重试`;
}
