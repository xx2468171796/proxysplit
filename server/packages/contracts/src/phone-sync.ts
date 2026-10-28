// 手机号注册 / 短信找回密码 / 配置云同步 / 云端配置（docs/plan-2026-10-29-free-sync-phone.md）
import { z } from 'zod'

/** 大陆手机号：去空格 / 横线 / +86 前缀后必须是 1[3-9] 开头的 11 位。 */
export const phoneSchema = z.string().trim().max(20).transform((v, ctx) => {
  let s = v.replace(/[\s\-()]/g, '')
  if (s.startsWith('+86')) s = s.slice(3)
  else if (s.startsWith('0086')) s = s.slice(4)
  else if (s.length === 13 && s.startsWith('86')) s = s.slice(2)
  if (!/^1[3-9]\d{9}$/.test(s)) { ctx.addIssue({ code: 'custom', message: '手机号格式不正确' }); return z.NEVER }
  return s
})
export const smsCodeSchema = z.string().trim().regex(/^\d{6}$/)
export const smsPurposes = ['register', 'reset', 'bind'] as const
export type SmsPurpose = (typeof smsPurposes)[number]
export const smsSendSchema = z.object({ phone: phoneSchema, purpose: z.enum(smsPurposes) })
export const passwordResetSchema = z.object({ phone: phoneSchema, code: smsCodeSchema, password: z.string().min(8).max(256) })
export const bindPhoneSchema = z.object({ phone: phoneSchema, code: smsCodeSchema })

/** 单份配置包上限 2 MB（字符数）。 */
export const CONFIG_PAYLOAD_MAX = 2 * 1024 * 1024
const payload = z.string().min(2).max(CONFIG_PAYLOAD_MAX)
export const configSyncPutSchema = z.object({ payload, baseVersion: z.number().int().min(0) })
export const configSyncGetQuery = z.object({ meta: z.enum(['0', '1', 'true', 'false']).optional() })
const profileName = z.string().trim().min(1).max(40)
export const configProfileCreateSchema = z.object({ name: profileName, payload })
export const configProfileUpdateSchema = z.object({ name: profileName.optional(), payload: payload.optional() })
  .refine(v => v.name !== undefined || v.payload !== undefined, '至少修改名称或内容')
const secret = z.string().min(4).max(64)
export const configShareSchema = z.object({ password: secret })
export const configShareImportSchema = z.object({ shareCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}$/), password: z.string().min(1).max(64) })
export const configRestoreSchema = z.object({ password: z.string().max(64).optional() })
export const configRestorePasswordSchema = z.object({ password: secret.nullable(), currentPassword: z.string().max(64).optional() })

export type SmsSendInput = z.infer<typeof smsSendSchema>
export type PasswordResetInput = z.infer<typeof passwordResetSchema>
export type BindPhoneInput = z.infer<typeof bindPhoneSchema>
export type ConfigSyncPutInput = z.infer<typeof configSyncPutSchema>
export type ConfigProfileCreateInput = z.infer<typeof configProfileCreateSchema>
export type ConfigProfileUpdateInput = z.infer<typeof configProfileUpdateSchema>
export type ConfigRestorePasswordInput = z.infer<typeof configRestorePasswordSchema>
