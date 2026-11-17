// 开发预览：会员订单的假数据（mock-backend 用）。
// ?split=1 下单时拆成 2 笔；?order=split 已有一单拆 3 笔付了 1 笔（顶部横幅 + 会员页「继续支付」），?order=pending 一张没付的普通订单。
const mockOrder = (orderNo: string, amountCents: number) => ({
  orderNo,
  planName: "超级会员 · 年付",
  amountCents,
  currency: "CNY",
  status: "pending",
  payUrl: "https://pay.example",
  paidAt: "",
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  createdAt: new Date().toISOString(),
});

export function mockOpenOrders(kind: string | null): unknown[] {
  const piece = (n: number, status: string) => ({
    ...mockOrder(`PS9-${n}`, 20000),
    status,
    splitIndex: n,
    splitTotal: 3,
    groupId: "g9",
  });
  if (kind === "split") return [piece(1, "paid"), piece(2, "pending"), piece(3, "pending")];
  return kind === "pending" ? [mockOrder("PS8", 32800)] : [];
}

export const mockCheckout = (split: boolean): unknown =>
  split
    ? { split: true, orders: [mockOrder("PS1a", 20000), mockOrder("PS1b", 12800)] }
    : { split: false, orders: [], order: mockOrder("PS1", 32800) };
