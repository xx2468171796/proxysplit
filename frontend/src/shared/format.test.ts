import { describe, expect, it } from "vitest";
import {
  appLatencyText,
  fmtBytes,
  fmtRate,
  fmtUptime,
  fmtYuan,
  latencyGrade,
  latencyText,
  parseList,
  parseLog,
  remainingLabel,
  stripAnsi,
} from "./format";

describe("fmtRate", () => {
  it("chooses an adaptive unit", () => {
    expect(fmtRate(0)).toEqual({ value: "0.00", unit: "MB/s" });
    expect(fmtRate(512)).toEqual({ value: "512", unit: "B/s" });
    expect(fmtRate(2048)).toEqual({ value: "2.0", unit: "KB/s" });
    expect(fmtRate(3 * 1048576)).toEqual({ value: "3.00", unit: "MB/s" });
  });
});

describe("small formatters", () => {
  it("formats uptime, bytes and money", () => {
    expect(fmtUptime(3661)).toBe("01:01:01");
    expect(fmtBytes(0)).toBe("0");
    expect(fmtBytes(2048)).toBe("2K");
    expect(fmtBytes(1048576 * 1.5)).toBe("1.5M");
    expect(fmtYuan(1990)).toBe("19.90");
  });

  it("maps latency sentinels to words", () => {
    expect(latencyText(-99)).toBe("检测中…");
    expect(latencyText(0)).toBe("未检测");
    expect(latencyText(-1)).toBe("Google 不通");
    expect(latencyText(88)).toBe("88 ms");
    expect(appLatencyText(undefined)).toBe("测试");
    expect(appLatencyText(-2)).toBe("拦截");
    expect(appLatencyText(0)).toBe("直连");
    expect(latencyGrade(50)).toBe(4);
    expect(latencyGrade(250)).toBe(1);
    expect(latencyGrade(-1)).toBe(0);
  });

  it("splits lists on commas, spaces and newlines", () => {
    expect(parseList(" a.com, b.com\n10.0.0.0/8  ")).toEqual(["a.com", "b.com", "10.0.0.0/8"]);
  });
});

describe("remainingLabel", () => {
  const now = Date.parse("2026-10-22T00:00:00Z");
  it("handles lifetime, missing, expired and remaining", () => {
    expect(remainingLabel("", "lifetime-premium", now)).toBe("永久有效");
    expect(remainingLabel("", "", now)).toBe("未开通");
    expect(remainingLabel("2026-10-01T00:00:00Z", "", now)).toBe("已到期");
    expect(remainingLabel("2026-10-24T05:00:00Z", "", now)).toBe("剩余 2 天 5 小时");
    expect(remainingLabel("2026-10-22T02:30:00Z", "", now)).toBe("剩余 3 小时");
  });
});

describe("parseLog", () => {
  it("splits sing-box lines into columns", () => {
    expect(parseLog("+0800 2026-10-22 12:34:56 INFO [core] started")).toEqual({
      time: "12:34:56",
      level: "INFO",
      tag: "core",
      msg: "started",
    });
  });

  it("infers a level from our own messages", () => {
    expect(parseLog("[service] 启动失败: x").level).toBe("ERROR");
    expect(parseLog("订阅更新超时").level).toBe("WARN");
    expect(parseLog("WARNING something").level).toBe("WARN");
  });

  it("strips ANSI colours", () => {
    expect(stripAnsi("\x1b[36mINFO\x1b[0m ok")).toBe("INFO ok");
  });
});
