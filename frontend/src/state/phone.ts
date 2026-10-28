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

export async function sendSmsCode(phone: string, purpose: SmsPurpose): Promise<string> {
  const invalid = phoneError(phone);
  if (invalid) return invalid;
  return syncApi.sendSmsCode(cleanPhone(phone), purpose);
}

export async function resetPassword(phone: string, code: string, password: string): Promise<string> {
  const invalid = phoneError(phone) || codeError(code) || (password.length < 8 ? "新密码至少 8 位" : "");
  if (invalid) return invalid;
  return syncApi.resetPassword(cleanPhone(phone), code.trim(), password);
}

export async function bindPhone(phone: string, code: string): Promise<string> {
  const invalid = phoneError(phone) || codeError(code);
  if (invalid) return invalid;
  const err = await syncApi.bindPhone(cleanPhone(phone), code.trim());
  if (err) return err;
  closeBindPhone();
  await refreshLicense();
  return "";
}
