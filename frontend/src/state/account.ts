// 账号与会员：登录状态（license）、套餐 / 设备 / 订单 / 公告（commerce）及其动作。
import { api } from "../api/backend";
import type { AccountDevice, Announcement, LicenseStatus, MemberOrder, MemberPlan } from "../api/types";
import { createStore } from "../shared/store";

export type AccountState = {
  status: LicenseStatus;
  plans: MemberPlan[];
  devices: AccountDevice[];
  orders: MemberOrder[];
  announcements: Announcement[];
  loading: boolean;
  /** 购买 / 兑换 / 解绑等操作的错误，显示在会员中心顶部 */
  error: string;
  planLoadError: string;
  deviceLoadError: string;
  /** 会员中心弹框（已有权益时用；无权益时是整页闸门） */
  membershipOpen: boolean;
  membershipPrompted: boolean;
  redeemOpen: boolean;
  /** 免登录下载 / POWER云 浏览器授权进行中 */
  powervpnBusy: boolean;
  autoLoginBusy: boolean;
};

const EMPTY_LICENSE: LicenseStatus = {
  enabled: false,
  signedIn: false,
  authenticated: true,
  deviceLimitReached: false,
  username: "",
  plan: "",
  planCode: "",
  tier: "",
  maxDevices: 0,
  features: [],
  expiresAt: "",
  offlineUntil: "",
};

export const license = createStore<AccountState>({
  status: EMPTY_LICENSE,
  plans: [],
  devices: [],
  orders: [],
  announcements: [],
  loading: false,
  error: "",
  planLoadError: "",
  deviceLoadError: "",
  membershipOpen: false,
  membershipPrompted: false,
  redeemOpen: false,
  powervpnBusy: false,
  autoLoginBusy: false,
});

/** 中转站（AI 编程官网）来的客户由推广员服务：不显示作者联系方式、赞赏码、官网 / GitHub。 */
export const isAigwChannel = (s: LicenseStatus): boolean => s.channel === "aigw";
/** 试用或无权益时，登录后直接给出套餐选择。 */
const needsPlan = (s: LicenseStatus): boolean => !s.authenticated || s.planCode === "trial";

export async function refreshLicense(): Promise<void> {
  try {
    license.set({ status: await api.license() });
  } catch {
    /* 启动中 */
  }
}

// 支付可能在关掉付款框、甚至关掉软件后才完成：从最新的已付订单恢复一次权益。
let recoveredOrder = "";

async function recoverPaidOrder(orders: MemberOrder[]): Promise<void> {
  const s = license.get().status;
  const paid = orders.find((o) => o.status === "paid");
  if (!paid || !s.signedIn || s.authenticated || paid.orderNo === recoveredOrder) return;
  recoveredOrder = paid.orderNo;
  const err = await api.refreshEntitlement();
  if (!err) await refreshLicense();
  else {
    recoveredOrder = "";
    license.set({ error: err });
  }
}

async function loadAccountLists(): Promise<void> {
  const [devices, orders] = await Promise.all([api.devices(), api.orders()]);
  if (devices.err) {
    license.set({
      devices: [],
      deviceLoadError: "设备读取失败，当前登录会话可能已失效。请退出账号后重新登录，设备数据会从服务端恢复。",
    });
    await refreshLicense();
  } else license.set({ devices: devices.items, deviceLoadError: "" });
  if (!orders.err) {
    license.set({ orders: orders.items });
    await recoverPaidOrder(orders.items);
  }
}

/** 套餐每次都从后台实时读取；登录后再读设备和订单。 */
export async function loadCommerce(): Promise<void> {
  if (!license.get().status.enabled) return;
  license.set({ loading: true, planLoadError: "" });
  try {
    const plans = await api.plans();
    if (plans.err) license.set({ plans: [], planLoadError: `套餐读取失败：${plans.err}` });
    else if (!plans.items.length) license.set({ plans: [], planLoadError: "后台暂未返回可购买套餐，请刷新后重试。" });
    else license.set({ plans: plans.items });
    const ann = await api.announcements();
    if (!ann.err) license.set({ announcements: ann.items });
    if (!license.get().status.signedIn) {
      license.set({ devices: [], orders: [], deviceLoadError: "" });
      return;
    }
    await loadAccountLists();
  } catch (e) {
    license.set({ plans: [], planLoadError: "套餐读取失败，请检查网络后刷新。" });
    console.warn("[ProxySplit] commerce load failed", e);
  } finally {
    license.set({ loading: false });
  }
}

async function afterSignIn(forcePlans: boolean): Promise<void> {
  await refreshLicense();
  await loadCommerce();
  if (forcePlans || needsPlan(license.get().status)) license.set({ membershipOpen: true, membershipPrompted: true });
}

export async function login(username: string, password: string): Promise<string> {
  const err = await api.login(username.trim(), password);
  if (!err) await afterSignIn(false);
  return err;
}

/** 注册后直接展示试用说明和实时套餐，用户不必再去找续费入口。 */
export async function register(username: string, email: string, password: string, ref = ""): Promise<string> {
  const err = await api.register(username.trim(), email.trim(), password, ref.trim());
  if (!err) await afterSignIn(true);
  return err;
}

export function openMembership(): void {
  license.set({ membershipOpen: true });
  void loadCommerce();
}

export function closeMembership(): void {
  license.set({ membershipOpen: false });
}

/** 侧栏常驻入口：未登录先引导开通，已登录直接弹兑换框。 */
export function openRedeem(): void {
  license.set({ error: "" });
  if (!license.get().status.authenticated) openMembership();
  else license.set({ redeemOpen: true });
}

export async function redeem(code: string): Promise<string> {
  const trimmed = code.trim();
  if (!trimmed) return "请输入兑换码";
  const err = await api.redeemCode(trimmed);
  if (err) return err;
  await refreshLicense();
  await loadCommerce();
  license.set({ redeemOpen: false });
  return "";
}

export async function refreshEntitlement(): Promise<string> {
  const err = await api.refreshEntitlement();
  await refreshLicense();
  return err;
}

/** 修改账号密码（新密码至少 8 位）。返回错误文字，'' = 成功。 */
export async function changePassword(current: string, next: string): Promise<string> {
  if (!current) return "请输入原密码";
  if (next.length < 8) return "新密码至少 8 位";
  return api.changePassword(current, next);
}

export type PlanGroups = { standard: MemberPlan[]; premium: MemberPlan[]; lifetime: MemberPlan[] };

/** 套餐分组：普通会员 / 超级会员（不含永久）/ 永久。 */
export function groupPlans(plans: readonly MemberPlan[]): PlanGroups {
  return {
    standard: plans.filter((p) => p.tier === "standard" && !p.lifetime),
    premium: plans.filter((p) => p.tier === "premium" && !p.lifetime),
    lifetime: plans.filter((p) => p.lifetime),
  };
}

/** 解绑旧设备；本机因名额已满未激活时，解绑后自动激活本机。返回提示或错误。 */
export async function unbindDevice(id: string): Promise<{ err?: string; notice?: string }> {
  const err = await api.unbindDevice(id);
  if (err) return { err };
  let notice: string | undefined;
  if (license.get().status.deviceLimitReached) {
    const activateErr = await api.activateCurrentDevice();
    if (activateErr) {
      await loadCommerce();
      return { err: `旧设备已解绑，但本机激活失败：${activateErr}` };
    }
    notice = "旧设备已解绑，本机已自动激活，可以启动代理";
  }
  await refreshLicense();
  await loadCommerce();
  return { notice };
}
