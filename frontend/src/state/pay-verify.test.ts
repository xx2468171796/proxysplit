import { describe, expect, it, vi } from "vitest";
import {
  CHALLENGE_REQUIRED,
  PAY_VERIFY_ORIGIN,
  type PayVerifyResult,
  placeVerifiedOrder,
  readRelayMessage,
} from "./pay-verify";

describe("readRelayMessage", () => {
  const n = "abc";
  it("只认官网来源 + 本次 nonce", () => {
    expect(readRelayMessage("https://evil.example", { type: "ps-hv-ok", nonce: n, token: "t" }, n)).toBeNull();
    expect(readRelayMessage(PAY_VERIFY_ORIGIN, { type: "ps-hv-ok", nonce: "other", token: "t" }, n)).toBeNull();
    expect(readRelayMessage(PAY_VERIFY_ORIGIN, "x", n)).toBeNull();
  });
  it("ready / 凭证 / 取消 / 加载失败", () => {
    expect(readRelayMessage(PAY_VERIFY_ORIGIN, { type: "ps-hv-ready", nonce: n }, n)).toBe("ready");
    expect(readRelayMessage(PAY_VERIFY_ORIGIN, { type: "ps-hv-ok", nonce: n, token: "t" }, n)).toEqual({
      kind: "token",
      token: "t",
    });
    expect(readRelayMessage(PAY_VERIFY_ORIGIN, { type: "ps-hv-cancel", nonce: n, reason: "cancelled" }, n)).toEqual({
      kind: "cancelled",
    });
    expect(readRelayMessage(PAY_VERIFY_ORIGIN, { type: "ps-hv-cancel", nonce: n, reason: "timeout" }, n)).toEqual({
      kind: "unavailable",
    });
    expect(readRelayMessage(PAY_VERIFY_ORIGIN, { type: "ps-hv-error", nonce: n }, n)).toEqual({ kind: "unavailable" });
    expect(readRelayMessage(PAY_VERIFY_ORIGIN, { type: "ps-hv-ok", nonce: n, token: "" }, n)).toEqual({
      kind: "unavailable",
    });
  });
});

const seq = (...items: PayVerifyResult[]) => {
  const fn = vi.fn<() => Promise<PayVerifyResult>>();
  for (const it of items) fn.mockResolvedValueOnce(it);
  return fn;
};

describe("placeVerifiedOrder", () => {
  it("取消验证不下单", async () => {
    const create = vi.fn(async () => ({}));
    expect(await placeVerifiedOrder(create, seq({ kind: "cancelled" }))).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
  it("凭证交给下单", async () => {
    const create = vi.fn(async (_t: string) => ({ ok: 1, errCode: undefined as string | undefined }));
    expect(await placeVerifiedOrder(create, seq({ kind: "token", token: "t1" }))).toEqual({
      ok: 1,
      errCode: undefined,
    });
    expect(create).toHaveBeenCalledWith("t1");
  });
  it("中心仍要验证：再验一次重下，只重试一次", async () => {
    const create = vi.fn(async (_t: string) => ({ errCode: CHALLENGE_REQUIRED }));
    const verify = seq({ kind: "token", token: "a" }, { kind: "token", token: "b" }, { kind: "token", token: "c" });
    expect(await placeVerifiedOrder(create, verify)).toEqual({ errCode: CHALLENGE_REQUIRED });
    expect(create.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });
  it("验证页没起来：不带凭证下单，由服务端决定，不反复弹", async () => {
    const create = vi.fn(async (_t: string) => ({ errCode: CHALLENGE_REQUIRED }));
    await placeVerifiedOrder(create, seq({ kind: "unavailable" }));
    expect(create.mock.calls).toEqual([[""]]);
  });
});
