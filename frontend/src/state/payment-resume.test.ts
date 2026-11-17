import { describe, expect, it } from "vitest";
import type { MemberOrder } from "../api/types";
import { findResumable, resumeLine } from "./payment-resume";

const NOW = Date.parse("2026-11-18T10:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

function order(orderNo: string, patch: Partial<MemberOrder> = {}): MemberOrder {
  return {
    orderNo,
    planName: "超级会员年卡",
    amountCents: 20000,
    currency: "CNY",
    status: "pending",
    payUrl: `weixin://wxpay/bizpayurl?pr=${orderNo}`,
    paidAt: "",
    expiresAt: at(20),
    createdAt: at(-5),
    ...patch,
  };
}
const piece = (orderNo: string, splitIndex: number, patch: Partial<MemberOrder> = {}) =>
  order(orderNo, { splitIndex, splitTotal: 3, groupId: "g1", ...patch });

describe("findResumable", () => {
  it("没有订单 / 都付完 / 都过期：没有可继续的", () => {
    expect(findResumable([], NOW)).toBeNull();
    expect(findResumable([order("A", { status: "paid" }), order("B", { expiresAt: at(-1) })], NOW)).toBeNull();
    expect(findResumable([order("C", { payUrl: "" }), order("D", { expiresAt: at(0.5) })], NOW)).toBeNull();
  });

  it("没拆单的未付订单：取最新一张接着扫", () => {
    const r = findResumable([order("NEW", { createdAt: at(-1) }), order("OLD", { createdAt: at(-9) })], NOW);
    expect(r).toMatchObject({ total: 1, paid: 0, needsReissue: false });
    expect(r?.ready.map((o) => o.orderNo)).toEqual(["NEW"]);
  });

  it("拆 3 笔付了 1 笔、剩下的还有效：从第 2 笔接着付", () => {
    const r = findResumable([piece("P3", 3), piece("P2", 2), piece("P1", 1, { status: "paid" })], NOW);
    expect(r).toMatchObject({ total: 3, paid: 1, needsReissue: false });
    expect(r?.ready.map((o) => o.orderNo)).toEqual(["P2", "P3"]);
    expect(resumeLine(r as NonNullable<typeof r>)).toContain("已经付了 1 笔，还差 2 笔");
  });

  it("剩下的有过期 / 失败的：要重新下单让服务端补发", () => {
    const r = findResumable(
      [piece("P1", 1, { status: "paid" }), piece("P2", 2, { expiresAt: at(-3) }), piece("P3", 3, { status: "failed" })],
      NOW,
    );
    expect(r).toMatchObject({ paid: 1, needsReissue: true, ready: [] });
  });

  it("补发过的序号只看最新那张（旧的已关闭）", () => {
    const r = findResumable(
      [
        piece("P1", 1, { status: "paid" }),
        piece("P2-old", 2, { status: "closed", createdAt: at(-60) }),
        piece("P2-new", 2, { createdAt: at(-1) }),
        piece("P3", 3),
      ],
      NOW,
    );
    expect(r?.ready.map((o) => o.orderNo)).toEqual(["P2-new", "P3"]);
    expect(r?.needsReissue).toBe(false);
  });

  it("一笔没付且有过期的拆单不算（服务端不会接着那组）；有退款的也不算", () => {
    expect(findResumable([piece("P1", 1), piece("P2", 2, { expiresAt: at(-1) }), piece("P3", 3)], NOW)).toBeNull();
    expect(findResumable([piece("P1", 1, { status: "refunded" }), piece("P2", 2), piece("P3", 3)], NOW)).toBeNull();
  });

  it("已经付过钱的拆单排在更新的普通未付订单前面", () => {
    const r = findResumable(
      [order("SINGLE", { createdAt: at(-1) }), piece("P1", 1, { status: "paid" }), piece("P2", 2), piece("P3", 3)],
      NOW,
    );
    expect(r?.total).toBe(3);
  });

  it("老版本绑定不带组号：按套餐名 + 总笔数认同一组", () => {
    const r = findResumable(
      [piece("P1", 1, { status: "paid", groupId: undefined }), piece("P2", 2, { groupId: undefined })],
      NOW,
    );
    expect(r).toMatchObject({ paid: 1, total: 3, needsReissue: true });
  });
});
