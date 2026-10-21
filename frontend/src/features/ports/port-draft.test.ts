import { describe, expect, it } from "vitest";
import {
  batchDrafts,
  connectAddress,
  emptyPort,
  listenAddress,
  nextFreePort,
  validateBatch,
  validatePort,
} from "./port-draft";

describe("emptyPort", () => {
  it("没有端口时从 10801 开始", () => {
    expect(emptyPort([]).port).toBe(10801);
    expect(emptyPort([]).name).toBe("浏览器1");
  });
  it("接着最大端口往后排", () => {
    expect(emptyPort([{ port: 10801 }, { port: 10805 }]).port).toBe(10806);
  });
});

describe("nextFreePort", () => {
  it("跳过已占用的端口", () => {
    expect(nextFreePort([10801, 10802])).toBe(10803);
  });
});

describe("validatePort", () => {
  it("名称和端口范围", () => {
    expect(validatePort({ name: " ", port: 1080 })).toContain("名称");
    expect(validatePort({ name: "a", port: 0 })).toContain("端口");
    expect(validatePort({ name: "a", port: 70000 })).toContain("端口");
    expect(validatePort({ name: "a", port: 10801 })).toBe("");
  });
});

describe("validateBatch", () => {
  it("数量、范围与占用", () => {
    const plan = { prefix: "浏览器", start: 10801, count: 3 };
    expect(validateBatch(plan, [])).toBe("");
    expect(validateBatch({ ...plan, count: 0 }, [])).toContain("数量");
    expect(validateBatch({ ...plan, start: 65535 }, [])).toContain("65535");
    expect(validateBatch(plan, [10802])).toContain("10802");
  });
});

describe("batchDrafts", () => {
  it("端口递增、名称编号、沿用设置", () => {
    const base = { ...emptyPort([]), lan: true, mode: "global" as const };
    const list = batchDrafts(base, { prefix: "", start: 20000, count: 3 });
    expect(list.map((p) => p.port)).toEqual([20000, 20001, 20002]);
    expect(list.map((p) => p.name)).toEqual(["浏览器1", "浏览器2", "浏览器3"]);
    expect(list.every((p) => p.lan && p.mode === "global" && p.id === "")).toBe(true);
  });
});

describe("addresses", () => {
  it("监听地址与连接地址", () => {
    expect(listenAddress({ lan: true, port: 1 })).toBe("0.0.0.0:1");
    expect(listenAddress({ lan: false, port: 1 })).toBe("127.0.0.1:1");
    expect(connectAddress({ lan: true, port: 1 }, "192.168.1.5")).toBe("192.168.1.5:1");
    expect(connectAddress({ lan: false, port: 1 }, "192.168.1.5")).toBe("127.0.0.1:1");
    expect(connectAddress({ lan: true, port: 1 }, "")).toBe("127.0.0.1:1");
  });
});
