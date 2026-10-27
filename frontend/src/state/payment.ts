// 会员付款：下单 → 支付宝二维码 → 每 3 秒查单（后台标签页暂停，回前台立即查一次）→ 到账后刷新权益。
// 超过渠道单笔限额的订单会拆成几笔，按顺序付：付完一笔自动换下一笔的二维码，全部付完才发货。
import { api } from "../api/backend";
import type { MemberOrder, MemberPlan } from "../api/types";
import { createStore } from "../shared/store";
import { license, loadCommerce, refreshLicense } from "./account";

export type PaymentState = {
  order: MemberOrder | null;
  qr: string;
  split: MemberOrder[];
  splitIdx: number;
  busy: boolean;
};

export const payment = createStore<PaymentState>({ order: null, qr: "", split: [], splitIdx: 0, busy: false });

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
  payment.set({ order: order ?? null, qr: "" });
  if (!order?.payUrl) return fail("支付服务未返回支付宝付款链接，请重新创建订单");
  const qr = await api.paymentQR(order.payUrl);
  if (qr.err || !qr.data) return fail(qr.err || "支付宝二维码生成失败");
  payment.set({ qr: qr.data });
  startPolling();
}

export function closePayment(): void {
  stopPolling();
  payment.set({ order: null, qr: "", split: [], splitIdx: 0 });
}

export async function buyPlan(plan: MemberPlan): Promise<void> {
  payment.set({ busy: true });
  license.set({ error: "" });
  try {
    const r = await api.createOrder(plan.id);
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
      const { split, splitIdx } = payment.get();
      fail(
        split.length > 1
          ? `第 ${splitIdx + 1} 笔暂未查询到支付成功，请完成本笔支付后重试`
          : "暂未查询到支付成功，请完成支付后重试",
      );
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : "刷新到账失败，请重试");
  } finally {
    payment.set({ busy: false });
  }
}

export async function openPaymentInBrowser(): Promise<void> {
  const o = payment.get().order;
  const url = o?.checkoutUrl || o?.payUrl;
  if (url) await api.openPaymentURL(url);
}
