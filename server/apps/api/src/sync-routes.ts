// 配置云同步 + 云端命名配置（会员专属）+ 分享导入（任何已登录用户）。
// 存储在 core config-sync.ts / config-profiles.ts，合同 docs/plan-2026-10-29-free-sync-phone.md。
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AppError } from '@proxysplit/shared'
import { CONFIG_PAYLOAD_MAX, configProfileCreateSchema, configProfileUpdateSchema, configRestorePasswordSchema, configRestoreSchema, configShareImportSchema, configShareSchema, configSyncGetQuery, configSyncPutSchema } from '@proxysplit/contracts'
import { profileQuota, type ConfigProfilesStore, type ConfigSyncStore, type Effective } from '@proxysplit/core'

export type SyncDeps = {
  user: (req: FastifyRequest) => Promise<{ userId: string; deviceId: string }>
  effective: (userId: string) => Promise<Effective>
  deviceName: (deviceId: string) => Promise<string>
  sync: ConfigSyncStore
  profiles: ConfigProfilesStore
}
/** JSON 转义会让正文比 2 MB 字符串大，留余量。 */
const BODY_LIMIT = CONFIG_PAYLOAD_MAX * 2
const limit = { rateLimit: { max: 30, timeWindow: '1 minute' } }
const idParam = z.object({ id: z.string().uuid() })
const profileId = (req: FastifyRequest) => {
  const r = idParam.safeParse(req.params)
  if (!r.success) throw new AppError('NOT_FOUND', '配置不存在', 404)
  return r.data.id
}

/** 设了恢复密码的配置：GET / DELETE 用请求头 x-restore-password 带恢复密码。 */
const restoreHeader = (req: FastifyRequest) => {
  const h = req.headers['x-restore-password']
  return typeof h === 'string' && h ? h : undefined
}

export function registerSyncRoutes(app: FastifyInstance, d: SyncDeps) {
  const member = async (req: FastifyRequest) => {
    const p = await d.user(req), e = await d.effective(p.userId)
    if (!e.member) throw new AppError('SYNC_MEMBER_ONLY', '云同步是会员功能', 403)
    return { ...p, e }
  }

  app.get('/v1/me/config-sync', { config: limit }, async (req) => {
    const p = await member(req), q = configSyncGetQuery.parse(req.query)
    return q.meta === '1' || q.meta === 'true' ? d.sync.meta(p.userId) : d.sync.get(p.userId)
  })
  app.put('/v1/me/config-sync', { config: limit, bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const p = await member(req), input = configSyncPutSchema.parse(req.body)
    const r = await d.sync.put(p.userId, input.payload, input.baseVersion, await d.deviceName(p.deviceId))
    if (!r.ok) return reply.code(409).send({ error: { code: 'SYNC_CONFLICT', message: '云端配置已被其他设备更新' }, current: r.current })
    return r.meta
  })
  app.delete('/v1/me/config-sync', { config: limit }, async (req) => d.sync.remove((await member(req)).userId))

  app.get('/v1/me/config-profiles', { config: limit }, async (req) => {
    const p = await member(req), items = await d.profiles.list(p.userId)
    return { items, quota: profileQuota(p.e), used: items.length }
  })
  app.post('/v1/me/config-profiles', { config: limit, bodyLimit: BODY_LIMIT }, async (req) => {
    const p = await member(req)
    return d.profiles.create(p.userId, configProfileCreateSchema.parse(req.body), await d.deviceName(p.deviceId), profileQuota(p.e))
  })
  // 设了恢复密码的配置要带 x-restore-password（推荐改用 POST /:id/restore）；PUT 带 body.password，分享带 body.restorePassword。
  app.get('/v1/me/config-profiles/:id', { config: limit }, async (req) => {
    const p = await member(req)
    return d.profiles.restore(p.userId, profileId(req), restoreHeader(req))
  })
  app.post('/v1/me/config-profiles/:id/restore', { config: limit }, async (req) => {
    const p = await member(req)
    return d.profiles.restore(p.userId, profileId(req), configRestoreSchema.parse(req.body ?? {}).password)
  })
  app.put('/v1/me/config-profiles/:id', { config: limit, bodyLimit: BODY_LIMIT }, async (req) => {
    const p = await member(req)
    return d.profiles.update(p.userId, profileId(req), configProfileUpdateSchema.parse(req.body), await d.deviceName(p.deviceId))
  })
  app.put('/v1/me/config-profiles/:id/restore-password', { config: limit }, async (req) => {
    const p = await member(req)
    return d.profiles.setRestorePassword(p.userId, profileId(req), configRestorePasswordSchema.parse(req.body))
  })
  app.delete('/v1/me/config-profiles/:id', { config: limit }, async (req) => d.profiles.remove((await member(req)).userId, profileId(req), restoreHeader(req)))
  app.post('/v1/me/config-profiles/:id/share', { config: limit }, async (req) => {
    const p = await member(req)
    const input = configShareSchema.parse(req.body)
    return d.profiles.share(p.userId, profileId(req), input.password, input.restorePassword)
  })
  app.delete('/v1/me/config-profiles/:id/share', { config: limit }, async (req) => d.profiles.unshare((await member(req)).userId, profileId(req), restoreHeader(req)))
  // 导入别人分享的配置：任何档位，只要已登录；每用户 10 次 / 10 分钟、每 (码, IP) 10 次失败 / 小时、每码 100 次失败 / 小时（core 里按库判断）。
  app.post('/v1/config-share/import', { config: limit }, async (req) => {
    const p = await d.user(req), input = configShareImportSchema.parse(req.body)
    return d.profiles.importShare(p.userId, input.shareCode, input.password, req.ip)
  })
}
