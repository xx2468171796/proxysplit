import { describe, expect, it, vi } from "vitest";

vi.mock("../api/backend", () => ({ api: {} }));
const { AIGW_MAIN_WECHAT, aigwServiceWechat, freeDeviceCount, payMethodText } = await import("./account");
type LicenseStatus = Parameters<typeof aigwServiceWechat>[0];

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

describe("套餐接口顺带给的免费台数与付款方式", () => {
  const status = (freeDevices?: number) => ({ freeDevices }) as LicenseStatus;

  it("免费台数：本人授权里的优先，其次套餐接口，都没有按 1", () => {
    expect(freeDeviceCount({ status: status(3), catalog: { paymentMethods: [], freeDevices: 2 } })).toBe(3);
    expect(freeDeviceCount({ status: status(), catalog: { paymentMethods: [], freeDevices: 2 } })).toBe(2);
    expect(freeDeviceCount({ status: status(0), catalog: { paymentMethods: [], freeDevices: 2 } })).toBe(0);
    expect(freeDeviceCount({ status: status(), catalog: { paymentMethods: [], freeDevices: null } })).toBe(1);
  });

  it("付款方式说人话；服务端没说就不写", () => {
    expect(payMethodText(["wechat"])).toBe("用微信");
    expect(payMethodText(["alipay", "wechat"])).toBe("用支付宝或微信");
    expect(payMethodText([])).toBe("");
    expect(payMethodText(["paypal"])).toBe("");
  });
});
