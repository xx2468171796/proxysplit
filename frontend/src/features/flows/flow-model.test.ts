import { describe, expect, it } from "vitest";
import type { Conn } from "../../api/types";
import { buildFlowGraph, siteName } from "./flow-model";

const conn = (process: string, host: string, outTag: string): Conn =>
  ({ process, host, dest: host, outTag, outbound: outTag, upload: 10, download: 20 }) as Conn;

const conns = [
  conn("chrome.exe", "www.google.com:443", "proxy"),
  conn("chrome.exe", "mail.google.com:443", "proxy"),
  conn("chrome.exe", "a.b.c.baidu.com:443", "direct"),
  conn("qq.exe", "1.2.3.4:80", "reject"),
];

describe("flow-model", () => {
  it("siteName 去端口、长子域只留后三段", () => {
    expect(siteName("a.b.c.baidu.com:443")).toBe("c.baidu.com");
    expect(siteName("1.2.3.4:80")).toBe("1.2.3.4");
  });

  it("三列聚合：程序 → 路线 → 网站", () => {
    const g = buildFlowGraph(conns);
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining(["a:chrome", "a:qq", "r:proxy", "r:direct", "r:block", "s:www.google.com"]),
    );
    expect(g.nodes.find((n) => n.id === "a:chrome")?.conns).toBe(3);
    expect(g.edges.find((e) => e.id === "a:chrome>r:proxy")?.conns).toBe(2);
    expect(g.totalConns).toBe(4);
  });

  it("折叠的程序把网站合成「N 个网站」", () => {
    const g = buildFlowGraph(conns, { expanded: new Set(["a:qq"]) });
    expect(g.nodes.find((n) => n.id === "s:*chrome")?.label).toBe("3 个网站");
    expect(g.nodes.some((n) => n.id === "s:1.2.3.4")).toBe(true);
  });

  it("超出上限合成「其他程序」", () => {
    const g = buildFlowGraph(conns, { maxApps: 1 });
    expect(g.nodes.some((n) => n.id === "a:其他程序")).toBe(true);
  });
});
