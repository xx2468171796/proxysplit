// 手机号相关动作：发验证码、短信找回密码、给老账号绑定手机号。返回错误文字，'' = 成功。
import { syncApi } from "../api/sync";
import type { SmsPurpose } from "../api/types-account";
import { refreshLicense } from "./account";
import { CAPTCHA_REQUIRED, type HumanVerifyResult, openHumanVerify, withHumanVerify } from "./human-verify";
import { closeBindPhone } from "./prompts";

const PHONE = /^1\d{10}$/;

/** 去掉空格 / 横线 / +86，留 11 位数字。 */
export function cleanPhone(raw: string): string {
  return raw.replace(/[\s-]/g, "").replace(/^\+?86(?=1\d{10}$)/, "");
}

export function phoneError(raw: string): string {
  return PHONE.test(cleanPhone(raw)) ? "" : "请输入 11 位手机号";
}

export function codeError(code: string): string {
  return /^\d{6}$/.test(code.trim()) ? "" : "请输入 6 位短信验证码";
}

export type SmsSendOutcome = {
  /** 非空 = 失败，原样给用户看（服务端的话） */
  err: string;
  /** 要倒计时的秒数；失败时只有服务端说了要等多久（发送太频繁）才大于 0 */
  cooldown: number;
  /** 发送成功时服务端给的提示（可能为空） */
  message: string;
  /** 用户自己关掉了人机验证：没有发请求，什么都不用提示 */
  cancelled: boolean;
};

/**
 * 发验证码：先过人机验证（用途 sms）再带凭证发。取消验证 = 不发请求。
 * 验证页没起来也照样发（带空凭证），服务端怎么说就给用户看什么 —— 不假装发出去了。
 * 服务端说凭证不行（过期 / 无效）就再验一次重发，最多一次。
 */
export async function sendSmsCode(
  phone: string,
  purpose: SmsPurpose,
  verify: () => Promise<HumanVerifyResult> = () => openHumanVerify("sms"),
): Promise<SmsSendOutcome> {
  const invalid = phoneError(phone);
  if (invalid) return { err: invalid, cooldown: 0, message: "", cancelled: false };
  const r = await withHumanVerify(
    CAPTCHA_REQUIRED,
    (ticket) => syncApi.sendSmsCode(cleanPhone(phone), purpose, ticket),
    verify,
  );
  if (!r) return { err: "", cooldown: 0, message: "", cancelled: true };
  if (r.err) return { err: r.err, cooldown: Math.max(0, r.cooldownSeconds), message: "", cancelled: false };
  return { err: "", cooldown: r.cooldownSeconds > 0 ? r.cooldownSeconds : 60, message: r.message, cancelled: false };
}

/** 发码按钮所在的界面：发完要回写的几样东西。 */
export type SmsSendUi = {
  /** 界面还在不在（弹框关了 / 换页了就是 false） */
  alive: () => boolean;
  startCooldown: (seconds: number) => void;
  onError: (text: string) => void;
  onSent: (text: string) => void;
};

/** 发验证码并把结果交给界面。等人机验证和服务端的这段时间界面可能已经关掉：关掉了就什么都不回写。 */
export async function sendSmsCodeFor(
  phone: string,
  purpose: SmsPurpose,
  ui: SmsSendUi,
  send: typeof sendSmsCode = sendSmsCode,
): Promise<void> {
  const r = await send(phone, purpose);
  if (!ui.alive() || r.cancelled) return;
  // 发送太频繁：服务端说了还要等多久，按钮照样倒计时
  if (r.cooldown > 0) ui.startCooldown(r.cooldown);
  if (r.err) return ui.onError(r.err);
  ui.onSent(r.message || "验证码已发送，5 分钟内有效");
}

export async function resetPassword(phone: string, code: string, password: string): Promise<string> {
  const invalid = phoneError(phone) || codeError(code) || (password.length < 8 ? "新密码至少 8 位" : "");
  if (invalid) return invalid;
  return syncApi.resetPassword(cleanPhone(phone), code.trim(), password);
}

/** 已绑过手机号的账号换绑要当前登录密码 currentPassword。 */
export async function bindPhone(phone: string, code: string, currentPassword = ""): Promise<string> {
  const invalid = phoneError(phone) || codeError(code);
  if (invalid) return invalid;
  const err = await syncApi.bindPhone(cleanPhone(phone), code.trim(), currentPassword);
  if (err) return err;
  closeBindPhone();
  await refreshLicense();
  return "";
}
