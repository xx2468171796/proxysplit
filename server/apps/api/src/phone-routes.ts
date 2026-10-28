// 手机号：发短信验证码 / 短信找回密码 / 已登录补绑手机号（core phone-auth.ts，合同 docs/plan-2026-10-29-free-sync-phone.md）。
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { bindPhoneSchema, passwordResetSchema, smsSendSchema } from '@proxysplit/contracts'
import type { AuthService } from '@proxysplit/core'

type Audit = (actor: string, action: string, targetType: string, targetId: string, ip: string, result: string, metadata?: Record<string, unknown>) => Promise<void>
export type PhoneDeps = {
  auth: AuthService
  /** 已激活设备的会话；待解绑（pending）令牌不能绑手机号。 */
  user: (req: FastifyRequest) => Promise<{ userId: string }>
  audit: Audit
}

export function registerPhoneRoutes(app: FastifyInstance, d: PhoneDeps) {
  // 每 IP 每小时 20 条；同号 60 秒 1 条、每小时 5 条、每天 10 条在 core 里按库判断。
  // TODO（后续）：未登录用途（注册 / 找回）接滑块人机验证，见计划文档「手机号」。
  app.post('/v1/auth/sms/send', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req) => {
    const input = smsSendSchema.parse(req.body)
    return d.auth.phone.send(input.phone, input.purpose, input.purpose === 'bind' ? (await d.user(req)).userId : null)
  })
  app.post('/v1/auth/password/reset', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) =>
    d.auth.resetPasswordByPhone(passwordResetSchema.parse(req.body), req.ip))
  app.post('/v1/me/phone', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const p = await d.user(req)
    const input = bindPhoneSchema.parse(req.body)
    try {
      const r = await d.auth.bindPhone(p.userId, input)
      await d.audit(p.userId, 'user.phone.bind', 'user', p.userId, req.ip, 'success')
      return { ...r, phoneBound: true }
    } catch (e) {
      if ((e as { code?: string }).code === 'PASSWORD_INVALID') await d.audit(p.userId, 'user.phone.bind', 'user', p.userId, req.ip, 'denied').catch(() => {})
      throw e
    }
  })
}
