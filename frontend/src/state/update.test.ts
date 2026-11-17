// 「检查更新」和「安装更新」是两件事：后台每小时的检查不能把安装中的界面冲掉。
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ checkAppUpdate: vi.fn(), installAppUpdate: vi.fn(), appVersion: vi.fn() }));
vi.mock("../api/backend", () => ({ api }));

import type { AppUpdateStatus } from "../api/types";
import { appUpdate, checkAppUpdate, installAppUpdate, receiveAutoUpdate, receiveAutoUpdateFailed } from "./update";

const info = { enabled: true, current: "1.0.0", available: true, release: { version: "1.1.0" } } as AppUpdateStatus;

beforeEach(() => {
  api.checkAppUpdate.mockReset().mockResolvedValue(info);
  api.installAppUpdate.mockReset();
  appUpdate.set({ info, checking: false, installing: false });
});

describe("检查与安装互不干扰", () => {
  it("安装途中后台检查了一次：仍然是安装中", async () => {
    const install = Promise.withResolvers<string>();
    api.installAppUpdate.mockReturnValue(install.promise);
    const installing = installAppUpdate();
    expect(appUpdate.get().installing).toBe(true);

    await checkAppUpdate(true);
    expect(appUpdate.get()).toMatchObject({ installing: true, checking: false });

    install.resolve("");
    expect(await installing).toContain("即将自动重启");
    expect(appUpdate.get().installing).toBe(true); // 成功后等重启，一直保持
  });

  it("自动升级开始后检查了一次：仍然是安装中；失败才放开按钮", async () => {
    receiveAutoUpdate(info);
    await checkAppUpdate(true);
    expect(appUpdate.get().installing).toBe(true);
    receiveAutoUpdateFailed("下载中断");
    expect(appUpdate.get().installing).toBe(false);
  });

  it("检查中不会让升级按钮显示成安装中，也不挡住点安装", async () => {
    const check = Promise.withResolvers<AppUpdateStatus>();
    api.checkAppUpdate.mockReturnValue(check.promise);
    const checking = checkAppUpdate(true);
    expect(appUpdate.get()).toMatchObject({ checking: true, installing: false });
    api.installAppUpdate.mockResolvedValue("签名不对");
    expect(await installAppUpdate()).toBe("升级失败：签名不对");
    check.resolve(info);
    await checking;
    expect(appUpdate.get()).toMatchObject({ checking: false, installing: false });
  });

  it("已经在安装时再点一次不会重复安装", async () => {
    appUpdate.set({ installing: true });
    expect(await installAppUpdate()).toBe("");
    expect(api.installAppUpdate).not.toHaveBeenCalled();
  });
});
