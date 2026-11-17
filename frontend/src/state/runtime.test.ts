import { describe, expect, it, vi } from "vitest";

vi.mock("../api/backend", () => ({ api: {} }));

import type { Status } from "../api/types";
import { isRecovering, isRunning, runLabel, selfStopReason, startFailureText } from "./runtime";

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

describe("运行阶段（Go 的 runState / stopReason / captureState）", () => {
  const base: Status = {
    coreRunning: false,
    engineRunning: false,
    corePort: 0,
    nodeName: "",
    selectedId: "",
    ruleMode: "whitelist",
    uptimeSec: 0,
  };

  it("内核自动重启期间算“开着”：按钮是停止，文字是恢复中", () => {
    const s: Status = { ...base, runState: "recovering" };
    expect(isRunning(s)).toBe(true);
    expect(isRecovering(s)).toBe(true);
    expect(runLabel(s)).toBe("恢复中");
    expect(selfStopReason({ ...s, stopReason: "旧原因" })).toBe("");
  });

  it("接管引擎卡住后重启中也是恢复中；换配置重启单独一句", () => {
    expect(runLabel({ ...base, coreRunning: true, runState: "running", captureState: "restarting" })).toBe("恢复中");
    expect(runLabel({ ...base, coreRunning: true, runState: "restarting" })).toBe("重新连接中");
  });

  it("自己停下来：显示已停止并给出原因；用户点的停止没有原因", () => {
    const s: Status = { ...base, runState: "stopped", stopReason: "内核意外退出，自动重启没有成功" };
    expect(isRunning(s)).toBe(false);
    expect(runLabel(s)).toBe("已停止");
    expect(selfStopReason(s)).toBe("内核意外退出，自动重启没有成功");
    expect(selfStopReason({ ...base, runState: "stopped" })).toBe("");
    expect(selfStopReason(null)).toBe("");
  });

  it("老状态（没有 runState 字段）照旧按内核 / 引擎判断", () => {
    expect(runLabel({ ...base, coreRunning: true })).toBe("运行中");
    expect(runLabel(base)).toBe("已停止");
    expect(isRecovering(base)).toBe(false);
  });
});
