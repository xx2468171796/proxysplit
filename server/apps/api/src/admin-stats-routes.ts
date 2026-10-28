// 运营总览只读接口（后台重做 docs/admin-rebuild.md）：只读、管理员鉴权，与其它 /v1/admin 路由一致。
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AppError } from '@proxysplit/shared'
import { statsOverviewQuery, type AdminStatsQuery } from './admin-stats.js'

export type AdminStatsDeps = {
  admin: (req: FastifyRequest) => Promise<unknown>
  query: Pick<AdminStatsQuery, 'overview' | 'userCloud'>
}

const userParam = z.object({ id: z.string().uuid() })

export function registerAdminStatsRoutes(app: FastifyInstance, d: AdminStatsDeps) {
  app.get('/v1/admin/stats/overview', async (req) => {
    await d.admin(req)
    return d.query.overview(statsOverviewQuery.parse(req.query).days)
  })
  app.get('/v1/admin/users/:id/cloud', async (req) => {
    await d.admin(req)
    const p = userParam.safeParse(req.params)
    if (!p.success) throw new AppError('NOT_FOUND', '用户不存在', 404)
    return d.query.userCloud(p.data.id)
  })
}
