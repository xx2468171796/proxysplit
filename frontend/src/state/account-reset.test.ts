// 换账号（退出 / 换人登录 / 被服务端踢下线）后，上一个账号的数据一样都不能留在界面上。
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  license: vi.fn(),
  plans: vi.fn(),
  announcements: vi.fn(),
  devices: vi.fn(),
  orders: vi.fn(),
  refreshEntitlement: vi.fn(),
  fenxiao: vi.fn(),
}));
const syncApi = vi.hoisted(() => ({ profiles: vi.fn(), syncStatus: vi.fn() }));
vi.mock("../api/backend", () => ({ api, onBackendEvent: () => () => undefined }));
vi.mock("../api/sync", () => ({ syncApi }));
vi.mock("./data", () => ({ reloadData: vi.fn() }));

import type { LicenseStatus } from "../api/types-account";
import { license, loadCommerce, refreshLicense, resetAccountScopedState } from "./account";
import { configSync, loadProfiles } from "./configsync";
import { fenxiao, loadFenxiao, openFenxiao } from "./fenxiao";
import { closeMemberIntro, maybeShowMemberIntro, prompts } from "./prompts";

const status = (username: string): LicenseStatus => ({
  enabled: true,
  signedIn: username !== "",
  authenticated: username !== "",
  deviceLimitReached: false,
  username,
  plan: "",
  planCode: "free",
  tier: "free",
  maxDevices: 1,
  features: [],
  expiresAt: "",
  offlineUntil: "",
  member: false,
});
const fxMe = (link: string) => ({ err: "", data: { enabled: true, eligible: true, link, code: "A1" } });
const fxPage = { err: "", data: { items: [], total: 0 } };
const order = { orderNo: "PS-A", planName: "月卡", status: "pending", payUrl: "", amountCents: 1 };

async function signIn(username: string): Promise<void> {
  api.license.mockResolvedValue(status(username));
  await refreshLicense();
}

beforeEach(async () => {
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  api.plans.mockResolvedValue({ items: [{ id: "p1" }] });
  api.announcements.mockResolvedValue({ items: [{ id: "n1", title: "给 alice 的公告" }] });
  api.devices.mockResolvedValue({ items: [{ id: "d1" }] });
  api.orders.mockResolvedValue({ items: [order] });
  api.refreshEntitlement.mockResolvedValue("");
  api.fenxiao.mockImplementation(async (kind: string) => (kind === "me" ? fxMe("https://x/?ref=alice") : fxPage));
  syncApi.profiles.mockResolvedValue({ items: [{ id: "c1" }], quota: 3, used: 1 });
  syncApi.syncStatus.mockResolvedValue(null);
  await signIn("");
  await signIn("alice");
});

describe("换账号清空上一个账号的状态", () => {
  it("换人登录：推广、订单、设备、公告、错误、云端配置都清掉", async () => {
    await loadCommerce();
    openFenxiao();
    await loadFenxiao();
    await loadProfiles();
    license.set({ error: "alice 的报错", redeemOpen: true });
    expect(fenxiao.get().me?.link).toContain("alice");
    expect(license.get().orders).toHaveLength(1);

    await signIn("bob");

    expect(fenxiao.get()).toMatchObject({ open: false, me: null, error: "" });
    expect(fenxiao.get().withdrawals.items).toEqual([]);
    expect(license.get()).toMatchObject({ orders: [], devices: [], announcements: [], error: "", redeemOpen: false });
    expect(configSync.get()).toMatchObject({ profiles: [], used: 0, pending: null });
  });

  it("退出和被踢下线（登录状态变成未登录）同样清空", async () => {
    await loadFenxiao();
    await signIn("");
    expect(fenxiao.get().me).toBeNull();
  });

  it("同一个账号刷新状态不清空", async () => {
    await loadFenxiao();
    await signIn("alice");
    expect(fenxiao.get().me?.link).toContain("alice");
  });

  it("换账号前发出的请求晚回来，不写进新账号", async () => {
    const me = Promise.withResolvers<unknown>();
    const orders = Promise.withResolvers<unknown>();
    api.fenxiao.mockImplementation((kind: string) => (kind === "me" ? me.promise : Promise.resolve(fxPage)));
    api.orders.mockImplementation(() => orders.promise);
    const pending = loadFenxiao();
    const commerce = loadCommerce();
    await vi.waitFor(() => expect(api.orders).toHaveBeenCalled());

    await signIn("bob");
    me.resolve(fxMe("https://x/?ref=alice"));
    orders.resolve({ items: [order] });
    await Promise.all([pending, commerce]);

    expect(fenxiao.get()).toMatchObject({ me: null, loading: false });
    expect(license.get().orders).toEqual([]);
  });

  it("已付订单的权益恢复按账号各算各的", async () => {
    api.orders.mockResolvedValue({ items: [{ ...order, status: "paid" }] });
    await loadCommerce();
    await signIn("bob");
    await loadCommerce();
    expect(api.refreshEntitlement).toHaveBeenCalledTimes(2);
  });

  it("会员介绍「看过了」按账号记：alice 看过不影响 bob", async () => {
    maybeShowMemberIntro(license.get().status);
    expect(prompts.get().introOpen).toBe(true);
    closeMemberIntro();
    maybeShowMemberIntro(license.get().status);
    expect(prompts.get().introOpen).toBe(false);

    await signIn("bob");
    maybeShowMemberIntro(license.get().status);
    expect(prompts.get().introOpen).toBe(true);
    resetAccountScopedState();
    expect(prompts.get()).toMatchObject({ introOpen: false, bindPhoneOpen: false });
  });
});
