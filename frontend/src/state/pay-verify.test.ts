// 付款前人机验证的下单流程；验证层与中继页协议的测试在 human-verify.test.ts。
import { describe, expect, it, vi } from "vitest";
import type { HumanVerifyResult } from "./human-verify";
import { CHALLENGE_REQUIRED, placeVerifiedOrder } from "./pay-verify";

const seq = (...items: HumanVerifyResult[]) => {
  const fn = vi.fn<() => Promise<HumanVerifyResult>>();
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
