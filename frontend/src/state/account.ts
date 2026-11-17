// 账号与会员：登录状态（license）、套餐 / 设备 / 订单 / 公告（commerce）及其动作。
import { api, type PlanCatalog } from "../api/backend";
import { syncApi } from "../api/sync";
import type { AccountDevice, Announcement, LicenseStatus, MemberOrder, MemberPlan } from "../api/types";
import { createStore } from "../shared/store";
import { promptAfterSignIn, resetPrompts } from "./prompts";

export type AccountState = {
  status: LicenseStatus;
  plans: MemberPlan[];
  /** 套餐接口顺带给的：现在用什么付款、免费版能用几台（服务端没给 = 空 / null） */
  catalog: PlanCatalog;
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
  catalog: { paymentMethods: [], freeDevices: null },
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
/** 中转站客户唯一显示的客服微信（业主 2026-11-17）：服务端给的 contact 优先；没有时主站下载 = 业主微信，
 *  代理站下载（本机有 dealer）宁可不显示也不露业主的。 */
export const aigwServiceWechat = (s: LicenseStatus): string | null =>
  s.contact?.wechat || (s.dealer ? null : AIGW_MAIN_WECHAT);
export const AIGW_MAIN_WECHAT = "zyg69996";
/** 付费会员（tier 不是 free）：不弹赞赏码、能用云同步。老服务端没有 member 字段时按套餐判断。 */
export const isPaidMember = (s: LicenseStatus): boolean =>
  s.enabled &&
  s.signedIn &&
  s.authenticated &&
  (s.member ?? (s.planCode !== "" && s.planCode !== "trial" && s.planCode !== "free"));

// ---- 账号范围的状态：换了登录账号（退出、换人登录、被服务端踢下线）就全部清空 ----
// 这台电脑可能几个人轮着用：上一个人的邀请链接、余额、订单、报错一样都不能让下一个人看到。
// 各 store 用 onAccountReset 登记自己怎么清；异步请求在 await 之后用 accountEpoch() 比对，换过账号就丢弃结果。
const accountResetters = new Set<() => void>();
let epoch = 0;

/** 登记「换账号时清空自己」的做法（模块加载时调一次）。 */
export function onAccountReset(reset: () => void): void {
  accountResetters.add(reset);
}

/** 每换一次账号加一。请求发出前记下，回来后不一样就说明结果属于上一个账号。 */
export const accountEpoch = (): number => epoch;

const ACCOUNT_SCOPED_EMPTY = {
  devices: [],
  orders: [],
  announcements: [],
  error: "",
  deviceLoadError: "",
  membershipOpen: false,
  membershipPrompted: false,
  redeemOpen: false,
} satisfies Partial<AccountState>;

/** 清空所有只属于某个账号的界面状态。登录账号一变就调（setLicenseStatus 自动调，退出成功后也直接调）。 */
export function resetAccountScopedState(): void {
  epoch += 1;
  recoveredOrder = "";
  license.set(ACCOUNT_SCOPED_EMPTY);
  resetPrompts();
  for (const reset of accountResetters) reset();
}

const accountOf = (s: LicenseStatus): string => (s.signedIn ? s.username : "");

/** 登录状态只从这里写入：发现换了账号，先清空上一个账号的状态。 */
export function setLicenseStatus(status: LicenseStatus): void {
  const before = accountOf(license.get().status);
  license.set({ status });
  if (before !== "" && before !== accountOf(status)) resetAccountScopedState();
}

export async function refreshLicense(): Promise<void> {
  try {
    setLicenseStatus(await api.license());
  } catch {
    /* 启动中 */
  }
}

// 支付可能在关掉付款框、甚至关掉软件后才完成：从最新的已付订单恢复一次权益（按账号各记各的，换账号时清掉）。
let recoveredOrder = "";

async function recoverPaidOrder(orders: MemberOrder[]): Promise<void> {
  const s = license.get().status;
  const paid = orders.find((o) => o.status === "paid");
  if (!paid || !s.signedIn || isPaidMember(s) || paid.orderNo === recoveredOrder) return;
  recoveredOrder = paid.orderNo;
  const err = await api.refreshEntitlement();
  if (!err) await refreshLicense();
  else {
    recoveredOrder = "";
    license.set({ error: err });
  }
}

async function loadAccountLists(): Promise<void> {
  const at = epoch;
  const [devices, orders] = await Promise.all([api.devices(), api.orders()]);
  if (at !== epoch) return;
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
  const at = epoch;
  try {
    const plans = await api.plans();
    if (plans.err) license.set({ plans: [], planLoadError: `套餐读取失败：${plans.err}` });
    else if (!plans.items.length) license.set({ plans: [], planLoadError: "后台暂未返回可购买套餐，请刷新后重试。" });
    else
      license.set({
        plans: plans.items,
        catalog: { paymentMethods: plans.paymentMethods, freeDevices: plans.freeDevices },
      });
    const ann = await api.announcements();
    if (at !== epoch) return;
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

async function afterSignIn(): Promise<void> {
  await refreshLicense();
  await loadCommerce();
  promptAfterSignIn(license.get().status);
}

/** 登录框填用户名或手机号都行。 */
export async function login(account: string, password: string): Promise<string> {
  const err = await api.login(account.trim(), password);
  if (!err) await afterSignIn();
  return err;
}

export type PhoneSignup = { phone: string; code: string; username: string; password: string; ref: string };

/** 手机号注册：注册成功即登录本机（免费版），随后弹会员介绍。 */
export async function registerPhone(d: PhoneSignup): Promise<string> {
  const err = await syncApi.registerPhone(d.phone.trim(), d.code.trim(), d.username.trim(), d.password, d.ref.trim());
  if (!err) await afterSignIn();
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
/** 免费版能用几台：本人授权里的优先，其次套餐接口给的，都没有按 1。 */
export const freeDeviceCount = (s: Pick<AccountState, "status" | "catalog">): number =>
  s.status.freeDevices ?? s.catalog.freeDevices ?? 1;

const PAY_APP: Record<string, string> = { wechat: "微信", alipay: "支付宝" };
/** 「用微信」这样的半句；服务端没说付款方式时为空串（付款框仍按付款链接显示）。 */
export function payMethodText(methods: readonly string[]): string {
  const names = methods.map((m) => PAY_APP[m]).filter(Boolean);
  return names.length ? `用${names.join("或")}` : "";
}

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
