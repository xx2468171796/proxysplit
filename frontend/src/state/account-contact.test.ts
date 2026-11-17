import { describe, expect, it, vi } from "vitest";

vi.mock("../api/backend", () => ({ api: {} }));
const { AIGW_MAIN_WECHAT, aigwServiceWechat } = await import("./account");

const base = { enabled: true, signedIn: true, channel: "aigw" } as Parameters<typeof aigwServiceWechat>[0];

describe("aigwServiceWechat", () => {
  it("uses the server contact first (main site or dealer)", () => {
    expect(aigwServiceWechat({ ...base, contact: { wechat: "rjz665", brand: "文" }, dealer: "wen" })).toBe("rjz665");
    expect(aigwServiceWechat({ ...base, contact: { wechat: AIGW_MAIN_WECHAT } })).toBe("zyg69996");
  });
  it("main-site download without a server contact falls back to the owner", () => {
    expect(aigwServiceWechat({ ...base })).toBe("zyg69996");
  });
  it("dealer-site download never shows the owner's contact", () => {
    expect(aigwServiceWechat({ ...base, dealer: "wen" })).toBeNull();
    expect(aigwServiceWechat({ ...base, dealer: "wen", contact: null })).toBeNull();
  });
});
