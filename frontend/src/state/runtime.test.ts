import { describe, expect, it, vi } from "vitest";

vi.mock("../api/backend", () => ({ api: {} }));

import { startFailureText } from "./runtime";

describe("startFailureText", () => {
  it("原始原因永远原样显示", () => {
    for (const err of [
      "create tun interface: Access is denied.",
      "wintun: driver blocked by 火绒安全软件",
      "configure tun: 另一个 VPN 正在占用虚拟网卡",
      "需要管理员权限",
      "节点不存在",
    ]) {
      expect(startFailureText(err)).toContain(`启动失败：${err}`);
    }
  });

  it("和权限 / 虚拟网卡有关：附上排查提示，但不把原因说死成「没用管理员运行」", () => {
    const text = startFailureText("create tun interface: Access is denied.");
    expect(text).toContain("以管理员身份运行");
    expect(text).toContain("安全软件");
    expect(text).toContain("VPN");
    expect(text).not.toBe("启动失败：请关闭后「右键 → 以管理员身份运行」");
  });

  it("其它原因、WinDivert 驱动的报错不加这条提示", () => {
    expect(startFailureText("节点不存在")).toBe("启动失败：节点不存在");
    expect(startFailureText("WinDivert 打开失败（需管理员权限 / 可能被安全软件拦截）: x")).toBe(
      "启动失败：WinDivert 打开失败（需管理员权限 / 可能被安全软件拦截）: x",
    );
  });
});
