import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ sendSmsCode: vi.fn() }));
vi.mock("../api/sync", () => ({ syncApi: api }));
vi.mock("./account", () => ({ refreshLicense: vi.fn() }));
vi.mock("./prompts", () => ({ closeBindPhone: vi.fn() }));

import {
  CAPTCHA_REQUIRED,
  HUMAN_VERIFY_ORIGIN,
  type HumanVerifyResult,
  readRelayMessage,
  withHumanVerify,
} from "./human-verify";
import { sendSmsCode, sendSmsCodeFor } from "./phone";

const O = HUMAN_VERIFY_ORIGIN;
const n = "abc";

describe("readRelayMessage", () => {
  it("只认官网来源 + 本次 nonce", () => {
    expect(readRelayMessage("https://evil.example", { type: "ps-hv-ok", nonce: n, token: "t" }, n)).toBeNull();
    expect(readRelayMessage(O, { type: "ps-hv-ok", nonce: "other", token: "t" }, n)).toBeNull();
    expect(readRelayMessage(O, "x", n)).toBeNull();
    expect(readRelayMessage(O, { type: "something-else", nonce: n }, n)).toBeNull();
  });
  it("ready / 凭证 / 取消 / 加载失败（付款：老中继页不带 action 也认）", () => {
    expect(readRelayMessage(O, { type: "ps-hv-ready", nonce: n }, n)).toBe("ready");
    expect(readRelayMessage(O, { type: "ps-hv-ok", nonce: n, token: "t" }, n)).toEqual({ kind: "token", token: "t" });
    expect(readRelayMessage(O, { type: "ps-hv-ok", nonce: n, action: "pay", token: "t" }, n, "pay")).toEqual({
      kind: "token",
      token: "t",
    });
    expect(readRelayMessage(O, { type: "ps-hv-cancel", nonce: n, reason: "cancelled" }, n)).toEqual({
      kind: "cancelled",
    });
    expect(readRelayMessage(O, { type: "ps-hv-cancel", nonce: n, reason: "timeout" }, n)).toEqual({
      kind: "unavailable",
    });
    expect(readRelayMessage(O, { type: "ps-hv-error", nonce: n }, n)).toEqual({ kind: "unavailable" });
    expect(readRelayMessage(O, { type: "ps-hv-ok", nonce: n, token: "" }, n)).toEqual({ kind: "unavailable" });
    expect(readRelayMessage(O, { type: "ps-hv-ok", nonce: n, token: "x".repeat(1025) }, n)).toEqual({
      kind: "unavailable",
    });
  });
  it("发短信：只收用途是 sms 的凭证", () => {
    expect(readRelayMessage(O, { type: "ps-hv-ready", nonce: n, action: "sms" }, n, "sms")).toBe("ready");
    expect(readRelayMessage(O, { type: "ps-hv-ok", nonce: n, action: "sms", token: "t" }, n, "sms")).toEqual({
      kind: "token",
      token: "t",
    });
    // 付款用途的凭证（或老中继页：不认 action、一律按付款出题）拿来发短信必然被拒 → 当作验证页没起来
    expect(readRelayMessage(O, { type: "ps-hv-ok", nonce: n, action: "pay", token: "t" }, n, "sms")).toEqual({
      kind: "unavailable",
    });
    expect(readRelayMessage(O, { type: "ps-hv-ok", nonce: n, token: "t" }, n, "sms")).toEqual({ kind: "unavailable" });
    expect(readRelayMessage(O, { type: "ps-hv-ready", nonce: n }, n, "sms")).toEqual({ kind: "unavailable" });
    expect(
      readRelayMessage(O, { type: "ps-hv-cancel", nonce: n, action: "sms", reason: "cancelled" }, n, "sms"),
    ).toEqual({ kind: "cancelled" });
  });
});

const seq = (...items: HumanVerifyResult[]) => {
  const fn = vi.fn<() => Promise<HumanVerifyResult>>();
  for (const it of items) fn.mockResolvedValueOnce(it);
  return fn;
};

describe("withHumanVerify", () => {
  it("取消验证不执行", async () => {
    const run = vi.fn(async () => ({}));
    expect(await withHumanVerify("X", run, seq({ kind: "cancelled" }))).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
  it("验证页没起来：不带凭证执行一次，结果原样返回，不再重试", async () => {
    const run = vi.fn(async (_t: string) => ({ errCode: "X", err: "服务端的话" }));
    const verify = seq({ kind: "unavailable" }, { kind: "token", token: "never" });
    expect(await withHumanVerify("X", run, verify)).toEqual({ errCode: "X", err: "服务端的话" });
    expect(run.mock.calls).toEqual([[""]]);
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it("凭证被拒：再验一次重来，只重试一次", async () => {
    const run = vi.fn(async (_t: string) => ({ errCode: "X" }));
    const verify = seq({ kind: "token", token: "a" }, { kind: "token", token: "b" }, { kind: "token", token: "c" });
    expect(await withHumanVerify("X", run, verify)).toEqual({ errCode: "X" });
    expect(run.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });
});

describe("sendSmsCode", () => {
  const sent = { err: "", errCode: "", cooldownSeconds: 45, message: "验证码已发送，5 分钟内有效" };
  it("手机号不对：不弹验证、不发请求", async () => {
    api.sendSmsCode.mockReset();
    const verify = seq({ kind: "token", token: "t" });
    expect(await sendSmsCode("123", "register", verify)).toMatchObject({ err: "请输入 11 位手机号", cancelled: false });
    expect(verify).not.toHaveBeenCalled();
    expect(api.sendSmsCode).not.toHaveBeenCalled();
  });
  it("先验证，凭证随请求带上，倒计时用服务端给的秒数", async () => {
    api.sendSmsCode.mockReset().mockResolvedValue(sent);
    expect(await sendSmsCode("138 0013 8000", "register", seq({ kind: "token", token: "tk" }))).toEqual({
      err: "",
      cooldown: 45,
      message: sent.message,
      cancelled: false,
    });
    expect(api.sendSmsCode).toHaveBeenCalledWith("13800138000", "register", "tk");
  });
  it("取消验证：没有请求，也不算失败", async () => {
    api.sendSmsCode.mockReset();
    expect(await sendSmsCode("13800138000", "reset", seq({ kind: "cancelled" }))).toEqual({
      err: "",
      cooldown: 0,
      message: "",
      cancelled: true,
    });
    expect(api.sendSmsCode).not.toHaveBeenCalled();
  });
  it("验证页没起来：照样发（空凭证），服务端拒绝就把它的话给用户，不当成功", async () => {
    api.sendSmsCode.mockReset().mockResolvedValue({
      err: "安全验证未通过或已过期，请重新完成验证",
      errCode: CAPTCHA_REQUIRED,
      cooldownSeconds: 0,
      message: "",
    });
    const r = await sendSmsCode("13800138000", "bind", seq({ kind: "unavailable" }));
    expect(r).toEqual({ err: "安全验证未通过或已过期，请重新完成验证", cooldown: 0, message: "", cancelled: false });
    expect(api.sendSmsCode.mock.calls).toEqual([["13800138000", "bind", ""]]);
  });
  it("验证页没起来但服务端不要凭证（本地模式）：正常发出", async () => {
    api.sendSmsCode.mockReset().mockResolvedValue({ err: "", errCode: "", cooldownSeconds: 0, message: "" });
    expect(await sendSmsCode("13800138000", "register", seq({ kind: "unavailable" }))).toEqual({
      err: "",
      cooldown: 60,
      message: "",
      cancelled: false,
    });
  });
  it("凭证过期：再验一次重发", async () => {
    api.sendSmsCode
      .mockReset()
      .mockResolvedValueOnce({ err: "过期", errCode: CAPTCHA_REQUIRED, cooldownSeconds: 0, message: "" })
      .mockResolvedValueOnce(sent);
    const r = await sendSmsCode(
      "13800138000",
      "register",
      seq({ kind: "token", token: "a" }, { kind: "token", token: "b" }),
    );
    expect(r.err).toBe("");
    expect(api.sendSmsCode.mock.calls.map((c) => c[2])).toEqual(["a", "b"]);
  });
  it("发送太频繁：报错的同时带回要等的秒数", async () => {
    api.sendSmsCode.mockReset().mockResolvedValue({
      err: "发送太频繁，请 42 秒后再试",
      errCode: "SMS_COOLDOWN",
      cooldownSeconds: 42,
      message: "",
    });
    expect(await sendSmsCode("13800138000", "register", seq({ kind: "token", token: "a" }))).toEqual({
      err: "发送太频繁，请 42 秒后再试",
      cooldown: 42,
      message: "",
      cancelled: false,
    });
  });
});

describe("sendSmsCodeFor（把发码结果交给界面）", () => {
  const outcome = { err: "", cooldown: 60, message: "已发送", cancelled: false };
  const ui = (alive: boolean) => ({
    alive: () => alive,
    startCooldown: vi.fn(),
    onError: vi.fn(),
    onSent: vi.fn(),
  });
  it("界面还在：开始倒计时并提示", async () => {
    const u = ui(true);
    await sendSmsCodeFor("13800138000", "register", u, async () => outcome);
    expect(u.startCooldown).toHaveBeenCalledWith(60);
    expect(u.onSent).toHaveBeenCalledWith("已发送");
  });
  it("失败：报错，服务端给了等待秒数照样倒计时", async () => {
    const u = ui(true);
    await sendSmsCodeFor("13800138000", "register", u, async () => ({ ...outcome, err: "太频繁", cooldown: 42 }));
    expect(u.startCooldown).toHaveBeenCalledWith(42);
    expect(u.onError).toHaveBeenCalledWith("太频繁");
    expect(u.onSent).not.toHaveBeenCalled();
  });
  it("等结果的时候界面已经关了：什么都不回写", async () => {
    const u = ui(false);
    await sendSmsCodeFor("13800138000", "register", u, async () => ({ ...outcome, err: "太频繁" }));
    expect(u.startCooldown).not.toHaveBeenCalled();
    expect(u.onError).not.toHaveBeenCalled();
    expect(u.onSent).not.toHaveBeenCalled();
  });
});
