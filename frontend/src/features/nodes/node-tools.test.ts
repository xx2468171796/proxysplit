import { describe, expect, it } from "vitest";
import type { Node } from "../../api/types";
import { isDead, sortNodes } from "./node-tools";

const n = (name: string, latency?: number) => ({ id: name, name, latency }) as Node;

describe("node tools", () => {
  it("sorts by latency: reachable fastest first, untested next, dead last", () => {
    const got = sortNodes([n("dead", -1), n("slow", 300), n("new"), n("fast", 80)], "latency").map((x) => x.name);
    expect(got).toEqual(["fast", "slow", "new", "dead"]);
  });
  it("sorts names naturally", () => {
    expect(sortNodes([n("香港10"), n("香港2")], "name").map((x) => x.name)).toEqual(["香港2", "香港10"]);
  });
  it("only tested-and-failed nodes are dead", () => {
    expect([n("a", -1), n("b", -99), n("c", 0), n("d")].filter(isDead).map((x) => x.name)).toEqual(["a"]);
  });
});

describe("front node candidates", () => {
  it("excludes self, official lines and nodes that already have a front", async () => {
    const { frontCandidates } = await import("./node-via-dialog");
    const self = { id: "s", name: "s" } as Node;
    const list = [self, { id: "a", name: "a" }, { id: "o", name: "o", official: true }, { id: "c", name: "c", via: "a" }] as Node[];
    expect(frontCandidates(self, list).map((n) => n.id)).toEqual(["a"]);
  });
});
