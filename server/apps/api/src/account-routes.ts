// 后台账号操作（公司统一账号包 zhanghao，业务在 core 的 account.ts）：封禁 / 解封 / 改昵称 / 强制下线 / 操作流水。
// 每个动作带 requestId 幂等（老后台不传时服务端现生成）；会让人下线的动作同时吊销本项目会话。
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AccountService } from '@proxysplit/core'
import { adminActionsQuery, adminBanSchema, adminNicknameSchema, adminReasonSchema } from '@proxysplit/contracts'

type Deps = { account: AccountService; admin: (req: FastifyRequest) => Promise<{ userId: string }> }
const idOf = (req: FastifyRequest) => z.object({ id: z.guid() }).parse(req.params).id
const view = (u: { userId: string; status: string; bannedUntil: Date | null; bannedReason: string | null; nickname: string | null }) => ({
  id: u.userId, status: u.status, bannedUntil: u.bannedUntil?.toISOString() ?? null, bannedReason: u.bannedReason, nickname: u.nickname,
})

export function registerAccountRoutes(app: FastifyInstance, d: Deps) {
  const ctx = async (req: FastifyRequest, requestId?: string) => ({ operatorId: (await d.admin(req)).userId, requestId: requestId ?? randomUUID() })
  app.post('/v1/admin/users/:id/ban', async (req) => {
    const input = adminBanSchema.parse(req.body)
    return view(await d.account.ban(idOf(req), { days: input.days, reason: input.reason }, await ctx(req, input.requestId)))
  })
  app.post('/v1/admin/users/:id/unban', async (req) => {
    const input = adminReasonSchema.parse(req.body)
    return view(await d.account.unban(idOf(req), { reason: input.reason }, await ctx(req, input.requestId)))
  })
  app.post('/v1/admin/users/:id/nickname', async (req) => {
    const input = adminNicknameSchema.parse(req.body)
    return view(await d.account.setNickname(idOf(req), input.nickname || null, await ctx(req, input.requestId)))
  })
  app.post('/v1/admin/users/:id/revoke-sessions', async (req) => {
    const input = adminReasonSchema.parse(req.body)
    return view(await d.account.revokeSessions(idOf(req), { reason: input.reason }, await ctx(req, input.requestId)))
  })
  app.get('/v1/admin/users/:id/actions', async (req) => {
    await d.admin(req)
    const q = adminActionsQuery.parse(req.query)
    const items = await d.account.actions(idOf(req), { limit: q.limit, ...(q.beforeId ? { beforeId: q.beforeId } : {}) })
    return { items: items.map(a => ({ id: a.id, action: a.action, detail: a.detail, operatorId: a.operatorId, createdAt: a.createdAt.toISOString() })) }
  })
}
