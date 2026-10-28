// 手机号相关动作：发验证码、短信找回密码、给老账号绑定手机号。返回错误文字，'' = 成功。
import { syncApi } from "../api/sync";
import type { SmsPurpose } from "../api/types-account";
import { refreshLicense } from "./account";
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

/** 发验证码；cooldown = 服务端给的重发等待秒数（没给按 60）。 */
export async function sendSmsCode(phone: string, purpose: SmsPurpose): Promise<{ err: string; cooldown: number }> {
  const invalid = phoneError(phone);
  if (invalid) return { err: invalid, cooldown: 0 };
  const r = await syncApi.sendSmsCode(cleanPhone(phone), purpose);
  return { err: r.err, cooldown: r.cooldownSeconds > 0 ? r.cooldownSeconds : 60 };
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
