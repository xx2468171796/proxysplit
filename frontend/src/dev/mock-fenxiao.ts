// 开发预览：推广赚钱弹框的假数据（mock-backend 用）。
// 推广赚钱预览数据（?fenxiao=0 看「未开放」）
export const mockFenxiao = (closed: boolean): Record<string, unknown> => ({
  me: {
    enabled: !closed,
    eligible: true,
    code: "Q78TVDW4",
    link: "https://proxysplit.zygskins.cn/?ref=Q78TVDW4",
    tierName: "分销商",
    rates: [2000, 500],
    mode: "level",
    maxLevels: 2,
    freezeDays: 7,
    minWithdrawalCents: 1000,
    inviter: "to***5",
    account: {
      frozenCents: 3600,
      availableCents: 12850,
      withdrawingCents: 0,
      withdrawnCents: 20000,
      earnedCents: 36450,
      reversedCents: 0,
    },
    team: { direct: 6, team: 14, paidOrders: 23, commissionCents: 36450 },
  },
  team: {
    total: 2,
    items: [
      { username: "li***n", depth: 1, boundAt: "2026-10-20T08:00:00Z" },
      { username: "wa***g", depth: 2, boundAt: "2026-10-21T08:00:00Z" },
    ],
  },
  commissions: {
    total: 2,
    items: [
      {
        id: "1",
        level: 1,
        baseCents: 18000,
        rateBps: 2000,
        amountCents: 3600,
        status: "frozen",
        availableAt: "2026-10-31T08:00:00Z",
        createdAt: "2026-10-24T08:00:00Z",
        buyer: "li***n",
      },
      {
        id: "2",
        level: 2,
        baseCents: 9900,
        rateBps: 500,
        amountCents: 495,
        status: "available",
        availableAt: "2026-10-20T08:00:00Z",
        createdAt: "2026-10-13T08:00:00Z",
        buyer: "wa***g",
      },
    ],
  },
  withdrawals: {
    total: 1,
    items: [
      {
        id: "3",
        amountCents: 20000,
        status: "paid",
        payee: { method: "alipay", account: "a***@qq.com", name: "张三" },
        adminNote: "已转",
        createdAt: "2026-10-15T08:00:00Z",
      },
    ],
  },
});
