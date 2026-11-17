// 付款状态机：接着付没付完的订单、二维码失败后重试。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  license: vi.fn(),
  plans: vi.fn(),
  announcements: vi.fn(),
  devices: vi.fn(),
  orders: vi.fn(),
  refreshEntitlement: vi.fn(),
  createOrder: vi.fn(),
  paymentQR: vi.fn(),
}));
vi.mock("../api/backend", () => ({ api }));
vi.mock("../api/sync", () => ({ syncApi: {} }));
vi.mock("./pay-verify", () => ({
  placeVerifiedOrder: (create: (token: string) => Promise<unknown>) => create("hv"),
}));

import type { MemberOrder, MemberPlan } from "../api/types";
import { license } from "./account";
import { closePayment, confirmPaid, payment, resumePayment, retryQR, splitProgress } from "./payment";

const soon = () => new Date(Date.now() + 20 * 60_000).toISOString();
const piece = (orderNo: string, splitIndex: number, status = "pending"): MemberOrder => ({
  orderNo,
  planName: "年卡",
  amountCents: 20000,
  currency: "CNY",
  status,
  payUrl: `weixin://wxpay/bizpayurl?pr=${orderNo}`,
  paidAt: "",
  expiresAt: soon(),
  createdAt: new Date().toISOString(),
  splitIndex,
  splitTotal: 3,
  groupId: "g1",
});
const plan = { id: "plan-year", name: "年卡" } as MemberPlan;
const signedIn = { enabled: true, signedIn: true, authenticated: true, username: "alice" };

function serverOrders(items: MemberOrder[]): void {
  api.orders.mockResolvedValue({ items });
  license.set({ orders: items });
}

beforeEach(() => {
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  for (const fn of Object.values(api)) fn.mockReset();
  api.license.mockResolvedValue(signedIn);
  api.plans.mockResolvedValue({ items: [plan] });
  api.announcements.mockResolvedValue({ items: [] });
  api.devices.mockResolvedValue({ items: [] });
  api.refreshEntitlement.mockResolvedValue("");
  api.paymentQR.mockImplementation(async (url: string) => ({ data: `qr:${url}`, err: "" }));
  license.set({ status: { ...license.get().status, ...signedIn }, plans: [plan], error: "" });
});
afterEach(closePayment);

describe("继续支付", () => {
  it("拆 3 笔付了 1 笔：从第 2 笔的二维码接着付，付完自动换第 3 笔", async () => {
    serverOrders([piece("P1", 1, "paid"), piece("P2", 2), piece("P3", 3)]);
    await resumePayment();
    expect(payment.get().order?.orderNo).toBe("P2");
    expect(payment.get().qr).toContain("P2");
    expect(splitProgress(payment.get())).toEqual({ index: 2, total: 3 });
    expect(api.createOrder).not.toHaveBeenCalled();

    serverOrders([piece("P1", 1, "paid"), piece("P2", 2, "paid"), piece("P3", 3)]);
    await confirmPaid();
    expect(payment.get().order?.orderNo).toBe("P3");
    expect(splitProgress(payment.get())).toEqual({ index: 3, total: 3 });
  });

  it("剩下的过期了：按同一个套餐重新下单，服务端接着原来那组补发", async () => {
    const expired = { ...piece("P2", 2), expiresAt: new Date(Date.now() - 1000).toISOString() };
    serverOrders([piece("P1", 1, "paid"), expired, piece("P3", 3)]);
    api.createOrder.mockResolvedValue({ split: true, orders: [piece("P2b", 2), piece("P3", 3)] });
    await resumePayment();
    expect(api.createOrder).toHaveBeenCalledWith("plan-year", "hv");
    expect(payment.get().order?.orderNo).toBe("P2b");
    expect(splitProgress(payment.get())).toEqual({ index: 2, total: 3 });
  });

  it("补发后只剩最后一笔：照样显示「第 3 笔 / 共 3 笔」", async () => {
    serverOrders([piece("P1", 1, "paid"), piece("P2", 2, "paid"), piece("P3", 3)]);
    await resumePayment();
    expect(payment.get().order?.orderNo).toBe("P3");
    expect(splitProgress(payment.get())).toEqual({ index: 3, total: 3 });
  });

  it("没有可继续的订单：说清楚，不开付款框", async () => {
    serverOrders([]);
    await resumePayment();
    expect(payment.get().order).toBeNull();
    expect(license.get().error).toContain("没有找到");
  });
});

describe("二维码生成失败", () => {
  it("显示原因并可以重新生成，不再一直转圈", async () => {
    serverOrders([piece("P1", 1, "paid"), piece("P2", 2), piece("P3", 3)]);
    api.paymentQR.mockResolvedValueOnce({ data: "", err: "编码失败" });
    await resumePayment();
    expect(payment.get()).toMatchObject({ qr: "", qrError: "编码失败" });
    expect(payment.get().order?.orderNo).toBe("P2");

    await retryQR();
    expect(payment.get().qrError).toBe("");
    expect(payment.get().qr).toContain("P2");
  });

  it("订单没带付款链接：重试时先重读订单拿最新的链接", async () => {
    const noUrl = { ...piece("P2", 2), payUrl: "" };
    serverOrders([piece("P1", 1, "paid"), piece("P2", 2), piece("P3", 3)]);
    await resumePayment();
    payment.set({ order: noUrl, qr: "", qrError: "x" });
    await retryQR();
    expect(payment.get().qr).toContain("P2");
  });
});
