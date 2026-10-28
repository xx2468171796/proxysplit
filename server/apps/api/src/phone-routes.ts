// 手机号：发短信验证码 / 短信找回密码 / 已登录补绑手机号（core phone-auth.ts，合同 docs/plan-2026-10-29-free-sync-phone.md）。
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { bindPhoneSchema, passwordResetSchema, smsSendSchema } from '@proxysplit/contracts'
import type { AuthService } from '@proxysplit/core'

type Audit = (actor: string, action: string, targetType: string, targetId: string, ip: string, result: string, metadata?: Record<string, unknown>) => Promise<void>
export type PhoneDeps = {
  auth: AuthService
  user: (req: FastifyRequest) => Promise<{ userId: string }>
  optionalUser: (req: FastifyRequest) => Promise<string | null>
  audit: Audit
}

export function registerPhoneRoutes(app: FastifyInstance, d: PhoneDeps) {
  // 每 IP 每小时 20 条；同号 60 秒 1 条、每号每天 10 条在 core 里按库判断。
  app.post('/v1/auth/sms/send', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req) => {
    const input = smsSendSchema.parse(req.body)
    return d.auth.phone.send(input.phone, input.purpose, input.purpose === 'bind' ? await d.optionalUser(req) : null)
  })
  app.post('/v1/auth/password/reset', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) =>
    d.auth.resetPasswordByPhone(passwordResetSchema.parse(req.body), req.ip))
  app.post('/v1/me/phone', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const p = await d.user(req)
    const input = bindPhoneSchema.parse(req.body)
    const r = await d.auth.phone.bindPhone(p.userId, input.phone, input.code)
    await d.audit(p.userId, 'user.phone.bind', 'user', p.userId, req.ip, 'success')
    return { ...r, phoneBound: true }
  })
}
