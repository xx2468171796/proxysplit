// 官网的纯文案规则。运行：node --test website/src（Node 自带的测试器，直接读 .ts）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { devicesLine, errorMessage, planDevicesLabel } from "./site-copy.ts";

test("短信相关的错误：服务端的原话优先（要等几秒、今天还能发几次都在里面）", () => {
  assert.equal(errorMessage("SMS_COOLDOWN", "发送太频繁，请 42 秒后再试"), "发送太频繁，请 42 秒后再试");
  assert.equal(errorMessage("SMS_DAILY_LIMIT", "今天已发 5 次，明天再试"), "今天已发 5 次，明天再试");
  assert.equal(errorMessage("SMS_CODE_INVALID", "验证码不对，还能再试 2 次"), "验证码不对，还能再试 2 次");
});

test("短信错误服务端没给话：用本地兜底", () => {
  assert.equal(errorMessage("SMS_COOLDOWN", ""), "验证码发送太频繁，请稍等一会儿再试。");
  assert.equal(errorMessage("SMS_UNAVAILABLE", undefined), "短信服务暂时不可用，请稍后再试。");
});

test("其它认识的错误码：用本地的中文说明；不认识的用服务端的话，再没有用兜底", () => {
  assert.equal(errorMessage("PHONE_TAKEN", "phone taken"), "这个手机号已经注册过了，请直接下载软件登录。");
  assert.equal(errorMessage("SOMETHING_NEW", "服务端的新提示"), "服务端的新提示");
  assert.equal(errorMessage("", undefined), "请求失败，请稍后重试。");
});

test("设备数从套餐接口算：套餐给的是在免费 1 台之外另加的台数", () => {
  const plans = [
    { tier: "standard", maxDevices: 3 },
    { tier: "standard", maxDevices: 3 },
    { tier: "premium", maxDevices: 8 },
    { tier: "premium", maxDevices: 10 },
  ];
  assert.equal(planDevicesLabel(3), "另加 3 台设备");
  assert.equal(
    devicesLine(plans),
    "免费版可以在 1 台电脑上用；开通会员后另加设备：普通会员另加 3 台，超级会员另加 8～10 台。",
  );
  assert.equal(
    devicesLine([{ tier: "premium", maxDevices: 5 }]),
    "免费版可以在 1 台电脑上用；开通会员后另加设备：超级会员另加 5 台。",
  );
  assert.equal(devicesLine([]), "免费版可以在 1 台电脑上用；开通会员后按套餐另加设备。");
});
