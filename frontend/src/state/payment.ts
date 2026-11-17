// 会员付款：下单 → 付款二维码 → 每 3 秒查单（后台标签页暂停，回前台立即查一次）→ 到账后刷新权益。
// 超过渠道单笔限额的订单会拆成几笔，按顺序付：付完一笔自动换下一笔的二维码，全部付完才发货。
// 这里的状态只在内存里：关掉付款框 / 重启软件后，没付完的订单由 payment-resume 从订单列表认出来，resumePayment 接着付。
import { api } from "../api/backend";
import type { MemberOrder, MemberPlan } from "../api/types";
import { createStore } from "../shared/store";
import { license, loadCommerce, onAccountReset, refreshLicense } from "./account";
import { placeVerifiedOrder } from "./pay-verify";
import { findResumable } from "./payment-resume";

export type PaymentState = {
  order: MemberOrder | null;
  qr: string;
  /** 二维码没生成出来的原因；非空时付款框显示它和「重新生成二维码」 */
  qrError: string;
  split: MemberOrder[];
  splitIdx: number;
  busy: boolean;
};

export const payment = createStore<PaymentState>({
  order: null,
  qr: "",
  qrError: "",
  split: [],
  splitIdx: 0,
  busy: false,
});

let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;
const onVisible = () => {
  if (!document.hidden) void pollOnce();
};

function startPolling(): void {
  stopPolling();
  // admin-ui-audit-ignore short-poll: 扫码付款等待中查订单是否到账，只在付款弹窗开着时跑，付完即停；客户端没有服务器推送通道
  pollTimer = setInterval(() => {
    if (!document.hidden) void pollOnce();
  }, 3000);
  document.addEventListener("visibilitychange", onVisible);
}

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  document.removeEventListener("visibilitychange", onVisible);
}

const fail = (error: string) => license.set({ error });

async function showOrder(order: MemberOrder | undefined): Promise<void> {
  stopPolling();
  payment.set({ order: order ?? null, qr: "", qrError: "" });
  if (!order) return fail("支付服务没有返回订单，请重新下单");
  if (!order.payUrl) return void payment.set({ qrError: "这一单没有拿到付款链接" });
  const qr = await api.paymentQR(order.payUrl);
  if (qr.err || !qr.data) return void payment.set({ qrError: qr.err || "付款二维码生成失败" });
  payment.set({ qr: qr.data });
  startPolling();
}

/** 「重新生成二维码」：先重读订单（付款链接可能刚补上），再生成一次。 */
export async function retryQR(): Promise<void> {
  const current = payment.get().order;
  if (!current) return;
  payment.set({ qr: "", qrError: "" });
  const res = await api.orders();
  const fresh = res.err ? undefined : res.items.find((o) => o.orderNo === current.orderNo);
  await showOrder(fresh?.payUrl ? fresh : current);
}

export function closePayment(): void {
  stopPolling();
  payment.set({ order: null, qr: "", qrError: "", split: [], splitIdx: 0 });
}

/** 第几笔 / 共几笔：订单自己带的序号优先（接着付时手里只有剩下的几笔），没拆单返回 null。 */
export function splitProgress(
  s: Pick<PaymentState, "order" | "split" | "splitIdx">,
): { index: number; total: number } | null {
  const o = s.order;
  if (!o) return null;
  if (o.splitTotal && o.splitTotal > 1) return { index: o.splitIndex || s.splitIdx + 1, total: o.splitTotal };
  return s.split.length > 1 ? { index: s.splitIdx + 1, total: s.split.length } : null;
}

onAccountReset(closePayment);

export async function buyPlan(plan: MemberPlan): Promise<void> {
  payment.set({ busy: true });
  license.set({ error: "" });
  try {
    // 支付中心要求每笔订单先过人机验证：先弹验证，取消就不下单。
    const r = await placeVerifiedOrder((hvToken) => api.createOrder(plan.id, hvToken));
    if (!r) return;
    if (r.err) return fail(r.err);
    const split = r.split && r.orders.length > 1 ? r.orders : [];
    payment.set({ split, splitIdx: 0 });
    await showOrder(split[0] ?? r.order);
    await loadCommerce();
  } catch (e) {
    closePayment();
    fail(e instanceof Error ? e.message : "创建订单失败，请重试");
  } finally {
    payment.set({ busy: false });
  }
}

/**
 * 「继续支付」：接着付订单列表里没付完的那一单。剩下的几笔都还有效就直接出二维码；
 * 有过期 / 失败的就按同一个套餐再下一次单（服务端会接着原来那组补发，已付的照算）。
 */
export async function resumePayment(): Promise<void> {
  license.set({ error: "" });
  const r = findResumable(license.get().orders, Date.now());
  if (!r) return fail("没有找到可以继续支付的订单，请重新下单");
  if (!r.needsReissue) {
    payment.set({ split: r.ready.length > 1 ? r.ready : [], splitIdx: 0 });
    return showOrder(r.ready[0]);
  }
  const plan = license.get().plans.find((p) => p.name === r.planName);
  if (!plan) return fail(`请在下面重新选择「${r.planName}」下单，已经付过的部分会接着算`);
  await buyPlan(plan);
}

/** 当前这笔已到账：还有下一笔就换二维码，否则刷新权益并收起。 */
async function onPaid(): Promise<void> {
  const { split, splitIdx } = payment.get();
  if (split.length > 1 && splitIdx < split.length - 1) {
    payment.set({ splitIdx: splitIdx + 1 });
    await showOrder(split[splitIdx + 1]);
    return;
  }
  stopPolling();
  const err = await api.refreshEntitlement();
  if (err) return fail(err);
  closePayment();
  license.set({ membershipOpen: false });
  await refreshLicense();
}

function findOrder(orders: MemberOrder[]): MemberOrder | undefined {
  const no = payment.get().order?.orderNo;
  return orders.find((o) => o.orderNo === no);
}

async function pollOnce(): Promise<void> {
  if (!payment.get().order || polling) return;
  polling = true;
  try {
    const res = await api.orders();
    if (res.err) return;
    license.set({ orders: res.items });
    const order = findOrder(res.items);
    if (order?.status === "paid") await onPaid();
    else if (order && ["failed", "expired", "cancelled"].includes(order.status)) {
      closePayment();
      fail("订单已过期或取消，请重新下单");
    }
  } catch (e) {
    console.warn("[ProxySplit] payment poll failed", e);
  } finally {
    polling = false;
  }
}

/** 「我已支付，刷新状态」。 */
export async function confirmPaid(): Promise<void> {
  payment.set({ busy: true });
  license.set({ error: "" });
  try {
    await loadCommerce();
    const order = findOrder(license.get().orders);
    if (order?.status === "paid") await onPaid();
    else {
      const progress = splitProgress(payment.get());
      fail(
        progress
          ? `第 ${progress.index} 笔暂未查询到支付成功，请完成本笔支付后重试`
          : "暂未查询到支付成功，请完成支付后重试",
      );
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : "刷新到账失败，请重试");
  } finally {
    payment.set({ busy: false });
  }
}

const WECHAT_PAY = /^(weixin:\/\/wxpay\/|https:\/\/(wx\.tenpay\.com|payapp\.weixin\.qq\.com|payapp\.wechatpay\.cn)\/)/i;

/** 付款 App 名：统一支付中心目前给微信码，老网关是支付宝。 */
export function payApp(order: Pick<MemberOrder, "payUrl">): "微信" | "支付宝" {
  return WECHAT_PAY.test(order.payUrl ?? "") ? "微信" : "支付宝";
}

/** 「本机打开支付宝」只对支付宝链接 / https 收银台有意义；微信码只能手机扫。 */
export function canOpenPayment(order: Pick<MemberOrder, "payUrl" | "checkoutUrl">): boolean {
  if (payApp(order) === "微信") return false;
  const url = order.checkoutUrl || order.payUrl;
  return /^(https:\/\/|alipays:)/i.test(url ?? "");
}

export async function openPaymentInBrowser(): Promise<void> {
  const o = payment.get().order;
  const url = o?.checkoutUrl || o?.payUrl;
  if (url) await api.openPaymentURL(url);
}
