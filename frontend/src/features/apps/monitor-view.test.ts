import { describe, expect, it } from "vitest";
import type { AppAccess, AppStat } from "../../api/types";
import { countAccess, duration, exitSplit, matchAccess, plainReason, verdict } from "./monitor-view";

const a = (p: Partial<AppAccess>): AppAccess => ({
  time: "2026-10-22 14:00:00",
  host: "www.google.com",
  network: "tcp",
  outbound: "JP",
  rule: "",
  status: "成功",
  upload: 0,
  download: 0,
  process: "Ld9BoxHeadless.exe",
  seconds: 1,
  ...p,
});

describe("monitor-view", () => {
  it("counts 完成 with 成功 and filters by status / host / search", () => {
    const list = [
      a({}),
      a({ status: "完成" }),
      a({ status: "失败", host: "x.com", reason: "i/o timeout" }),
      a({ status: "拦截" }),
    ];
    expect(countAccess(list)).toEqual({ all: 4, live: 0, ok: 2, failed: 1, blocked: 1 });
    expect(list.filter((x) => matchAccess(x, "failed", "", "")).length).toBe(1);
    expect(list.filter((x) => matchAccess(x, "all", "timeout", "")).length).toBe(1);
    expect(list.filter((x) => matchAccess(x, "all", "", "x.com")).length).toBe(1);
  });

  it("splits exits and explains reasons in plain words", () => {
    expect(exitSplit([a({}), a({}), a({ outbound: "直连" })])[0]).toEqual({ exit: "JP", count: 2 });
    expect(plainReason("dial tcp 1.2.3.4:443: i/o timeout").short).toBe("连接超时");
    expect(plainReason("").short).toBe("");
  });

  it("writes a one-line verdict", () => {
    const s: AppStat = {
      process: "x",
      health: "warn",
      live: 0,
      total: 10,
      ok: 6,
      done: 1,
      failed: 3,
      upload: 0,
      download: 0,
    };
    expect(verdict(s)).toContain("10 条连接里 3 条失败");
    expect(verdict(undefined)).toContain("还没有捕捉到");
    expect(duration(125)).toBe("2 分 05 秒");
  });
});
