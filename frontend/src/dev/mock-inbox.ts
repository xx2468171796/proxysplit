// 消息中心（tongzhi）的假后端（浏览器预览用）：一条到账、一条到期提醒，已读状态记在内存里。
const now = Date.now();
const notice = (id: string, kind: string, title: string, body: string, minutesAgo: number) => ({
  notice: {
    id,
    kind,
    severity: "normal",
    surfaces: ["inbox", "toast"],
    title,
    body,
    cover: null,
    icon: null,
    actions: [],
    pinned: false,
    sortOrder: 0,
    frequency: "once",
    frequencyHours: 24,
    maxPopups: 1,
    forceRead: false,
    closable: true,
    status: "published",
    phase: "live",
    startAt: null,
    endAt: null,
    createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    publishedAt: new Date(now - minutesAgo * 60_000).toISOString(),
    revokedAt: null,
  },
  receipt: null as null | { readAt: string },
  payload: null,
  summary: body.replace(/\*\*/g, ""),
});
const inbox = [
  notice("n1", "reward", "会员已到账", "**普通会员月卡** 已生效，有效期到 2026/11/29。感谢支持！", 5),
  notice("n2", "warning", "会员快到期了", "你的会员将在 **2026/11/1** 到期，到期后会回到免费版。", 120),
];
const unread = () => inbox.filter((i) => !i.receipt).length;

export const mockInbox = () => ({
  TongzhiCall: (...args: unknown[]) => {
    const [method, path] = args.map(String) as [string, string];
    if (method === "POST" && (path === "/read" || path === "/read-all" || path === "/seen")) {
      for (const i of inbox) i.receipt = { readAt: new Date().toISOString() };
      return { status: 200, body: { ok: true } };
    }
    const bundle = {
      unread: unread(),
      inbox,
      popups: [],
      marquee: [],
      banners: [],
      toasts: [],
      serverTime: new Date().toISOString(),
    };
    if (path.startsWith("/bundle")) return { status: 200, body: bundle };
    if (path.startsWith("/unread")) return { status: 200, body: { unread: unread() } };
    if (path.startsWith("/feed")) return { status: 200, body: { items: inbox, nextCursor: null } };
    return { status: 200, body: { ok: true } };
  },
});
