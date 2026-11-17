// 没付完的订单：付款状态只在内存里，关掉付款框 / 重启软件后要能从「我的订单」接口重新认出来接着付。
// 纯函数，不读时间也不发请求。服务端规则（server/packages/core 的 createOrders / resumeSplitInTx）：
// 拆单里已经付过一笔的那组，再次下同一个套餐会接着原来那组走 —— 没过期的几笔原样返回，过期 / 失败的换新单号补发。
import type { MemberOrder } from "../api/types";

export type Resumable = {
  planName: string;
  /** 现在就能扫码付的几笔，按顺序 */
  ready: MemberOrder[];
  /** 已经付了几笔 */
  paid: number;
  /** 一共几笔（1 = 没拆单） */
  total: number;
  /** 剩下的里有过期 / 失败的：要重新下一次单，由服务端接着原来那组补发 */
  needsReissue: boolean;
};

/** 二维码至少还要有这么久才值得再让用户扫（和服务端判断「还有效」的余量一致） */
const MIN_LEFT_MS = 60_000;
/** 服务端只接着 30 天内的拆单 */
const GROUP_WINDOW_MS = 30 * 24 * 3600_000;

const time = (iso: string): number => Date.parse(iso) || 0;
const totalOf = (o: MemberOrder): number => (o.splitTotal && o.splitTotal > 1 ? o.splitTotal : 1);

function payable(o: MemberOrder, now: number): boolean {
  return o.status === "pending" && !!o.payUrl && time(o.expiresAt) > now + MIN_LEFT_MS;
}

/** 同一组拆单：有组号按组号（Go 的 license.Order.GroupID），服务端没给组号时按「套餐名 + 总笔数」认。 */
const groupKey = (o: MemberOrder): string => o.groupId || `${o.planName}|${o.splitTotal}`;

function splitGroup(pieces: MemberOrder[], now: number): Resumable | null {
  // 同一序号可能补发过：只看最新那张
  const latest = new Map<number, MemberOrder>();
  for (const o of pieces) {
    const cur = latest.get(o.splitIndex ?? 0);
    if (!cur || time(o.createdAt) > time(cur.createdAt)) latest.set(o.splitIndex ?? 0, o);
  }
  const rows = [...latest.values()].sort((a, b) => (a.splitIndex ?? 0) - (b.splitIndex ?? 0));
  const first = rows[0];
  if (!first || rows.some((o) => o.status === "refunded")) return null;
  const total = totalOf(first);
  const paid = rows.filter((o) => o.status === "paid").length;
  if (paid >= total) return null;
  const ready = rows.filter((o) => payable(o, now));
  const needsReissue = ready.length < total - paid;
  // 一笔都没付、又有过期的：服务端不会接着这组，当作没有
  if (paid === 0 && needsReissue) return null;
  return { planName: first.planName, ready, paid, total, needsReissue };
}

/** 从订单列表里找出还能接着付的那一单：已经付过钱的拆单优先，其次是最新的未付订单。没有返回 null。 */
export function findResumable(orders: readonly MemberOrder[], now: number): Resumable | null {
  const groups = new Map<string, MemberOrder[]>();
  for (const o of orders) {
    if (totalOf(o) === 1 || time(o.createdAt) < now - GROUP_WINDOW_MS) continue;
    const key = groupKey(o);
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const split = [...groups.values()].map((g) => splitGroup(g, now)).filter((r) => r !== null);
  const started = split.find((r) => r.paid > 0);
  if (started) return started;

  const single = orders
    .filter((o) => totalOf(o) === 1 && payable(o, now))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
  const candidates = [
    ...split,
    ...(single ? [{ planName: single.planName, ready: [single], paid: 0, total: 1, needsReissue: false }] : []),
  ];
  const newest = (r: Resumable): number => Math.max(...r.ready.map((o) => time(o.createdAt)));
  return candidates.sort((a, b) => newest(b) - newest(a))[0] ?? null;
}

/** 给用户看的一句话。 */
export function resumeLine(r: Resumable): string {
  if (r.total === 1) return `「${r.planName}」这一单还没付款，二维码还在有效期内，可以接着扫码。`;
  if (r.paid === 0) return `「${r.planName}」分 ${r.total} 笔支付，还一笔都没付，可以接着扫码。`;
  return `「${r.planName}」分 ${r.total} 笔支付，已经付了 ${r.paid} 笔，还差 ${r.total - r.paid} 笔，全部付完才会开通会员。`;
}
