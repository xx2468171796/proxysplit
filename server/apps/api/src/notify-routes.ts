// 站内通知 / 公告接口（公司统一通知包 tongzhi，业务在 core 的 notify.ts）：
// 用户侧 /v1/tongzhi/*（登录后，身份只投影 id + 档位 + 角色），后台 /v1/admin/tongzhi/*（管理员会话或 TZ_AI_TOKEN），
// 老客户端的 /v1/announcements 从 notice 派生。
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Notify } from '@proxysplit/core'

type Principal = { userId: string; role: string }
type Deps = {
  notify: Notify
  auth: (req: FastifyRequest) => Promise<Principal>
  admin: (req: FastifyRequest) => Promise<Principal>
  tierOf: (userId: string) => Promise<string>
}

const subPath = (req: FastifyRequest, prefix: string) => req.url.split('?')[0]!.slice(prefix.length) || '/'
const query = (req: FastifyRequest) => req.query as Record<string, string>
const bodyOf = (req: FastifyRequest) => (req.method === 'GET' || req.method === 'DELETE' ? undefined : (req.body ?? {}))

export function registerNotifyRoutes(app: FastifyInstance, d: Deps) {
  app.get('/v1/announcements', async () => ({ items: await d.notify.legacyAnnouncements() }))

  const PLAYER = '/v1/tongzhi'
  app.route({
    method: ['GET', 'POST'],
    url: `${PLAYER}/*`,
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    handler: async (req, reply) => {
      const p = await d.auth(req)
      const r = await d.notify.http.dispatchPlayer(
        { method: req.method, path: subPath(req, PLAYER), query: query(req), body: bodyOf(req) },
        { userId: p.userId, tier: await d.tierOf(p.userId), roles: [p.role], tags: [] },
      )
      return reply.code(r.status).header('cache-control', 'no-store').send(r.body)
    },
  })

  const ADMIN = '/v1/admin/tongzhi'
  app.route({
    method: ['GET', 'POST', 'PUT', 'DELETE'],
    url: `${ADMIN}/*`,
    handler: async (req, reply) => {
      // AI 通道（tzctl）只认本机来源 + 令牌；其余走管理员会话
      const ai = d.notify.ai.authenticate({ ip: req.ip, headers: req.headers as Record<string, string> })
      const actor = ai ? { id: ai.sub, source: 'cli' } : { id: (await d.admin(req)).userId, source: 'admin' }
      const r = await d.notify.http.dispatchAdmin(
        { method: req.method, path: subPath(req, ADMIN), query: query(req), body: bodyOf(req) },
        actor,
      )
      return reply.code(r.status).send(r.body)
    },
  })
}
