import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  setClashMode: vi.fn<(mode: string) => Promise<string>>(),
  setAppRules: vi.fn<(rules: unknown) => Promise<string>>(),
  setSettings: vi.fn<(s: unknown) => Promise<string>>(),
  status: vi.fn(async () => null),
}));
vi.mock("../api/backend", () => ({ api }));

const { data, NOT_LOADED, saveSettings, setClashMode } = await import("./data");
const { updateRule, removeRule } = await import("./app-rules");

const rule = (match: string) => ({ match, path: match, line: "rule", node: "", enabled: true });

beforeEach(() => {
  vi.clearAllMocks();
  data.set({ loaded: true, clashMode: "rule", rules: [rule("Code.exe"), rule("chrome.exe")] });
});

describe("setClashMode", () => {
  it("Go 拒绝时退回原值，并返回带「失败」的提示", async () => {
    api.setClashMode.mockResolvedValue("core not running");
    const err = await setClashMode("global");
    expect(err).toBe("切换代理策略失败：core not running");
    expect(data.get().clashMode).toBe("rule");
  });

  it("成功时保留新值", async () => {
    api.setClashMode.mockResolvedValue("");
    expect(await setClashMode("direct")).toBe("");
    expect(data.get().clashMode).toBe("direct");
  });
});

describe("应用规则写入", () => {
  it("按程序名定位，不受列表顺序变化影响", async () => {
    api.setAppRules.mockResolvedValue("");
    data.set({ rules: [rule("chrome.exe"), rule("Code.exe")] });
    await updateRule("code.exe", { enabled: false });
    expect(data.get().rules.map((r) => [r.match, r.enabled])).toEqual([
      ["chrome.exe", true],
      ["Code.exe", false],
    ]);
    await removeRule("CHROME.EXE");
    expect(data.get().rules.map((r) => r.match)).toEqual(["Code.exe"]);
  });

  it("首屏数据到达前拒绝写入，不覆盖用户已保存的配置", async () => {
    data.set({ loaded: false });
    expect(await updateRule("Code.exe", { enabled: false })).toBe(NOT_LOADED);
    expect(await saveSettings({ lanShare: true })).toBe(NOT_LOADED);
    expect(api.setAppRules).not.toHaveBeenCalled();
    expect(api.setSettings).not.toHaveBeenCalled();
  });
});
