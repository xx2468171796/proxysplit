// 同事节点上报：POST /v1/client/nodes（客户端）+ /v1/admin/client-nodes|client-subs/*（后台）+ 变化记录保留期清理。
// 合同 docs/节点上报.md / @proxysplit/contracts client-nodes.ts，入库 / 查询在 core client-nodes-store.ts / client-nodes-query.ts。
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AppError } from '@proxysplit/shared'
import { clientNodeChangesQuery, clientNodeListQuery, clientNodeReportSchema, clientNodeRevealSchema, clientSubListQuery, clientSubRevealSchema } from '@proxysplit/contracts'
import type { ClientNodesQuery, ClientNodesStore } from '@proxysplit/core'
import { DeviceLimiter, gzipPreParsing } from './telemetry-routes.js'

/** 解压后单次上报上限（docs/节点上报.md：≤ 2 MB）。 */
export const NODES_MAX_BODY_BYTES = 2 * 1024 * 1024
export const NODE_CHANGES_RETENTION_DAYS = 90

type Principal = { userId: string; role: string }
type Audit = (actor: string, action: string, targetType: string, targetId: string, ip: string, result: string, metadata?: Record<string, unknown>) => Promise<void>
export type ClientNodesDeps = {
  store: Pick<ClientNodesStore, 'ingest' | 'purge'>
  query: Pick<ClientNodesQuery, 'listNodes' | 'listSubs' | 'changes' | 'stats' | 'revealNode' | 'revealSub'>
  optionalUser: (req: FastifyRequest) => Promise<string | null>
  admin: (req: FastifyRequest) => Promise<Principal>
  /** 当前管理员是不是超管（能解密链接）。 */
  isSuperAdmin: (p: Principal) => Promise<boolean>
  audit: Audit
  perDevicePerMinute: number
  perIpPerMinute: number
  runRetention: boolean
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void }
}

export function registerClientNodesRoutes(app: FastifyInstance, d: ClientNodesDeps) {
  const limiter = new DeviceLimiter(d.perDevicePerMinute)
  app.post('/v1/client/nodes', {
    bodyLimit: NODES_MAX_BODY_BYTES,
    config: { rateLimit: { max: d.perIpPerMinute, timeWindow: '1 minute' } },
    preParsing: gzipPreParsing(NODES_MAX_BODY_BYTES),
  }, async (req) => {
    const report = clientNodeReportSchema.parse(req.body)
    const header = String(req.headers['x-device-id'] ?? '')
    if (header !== report.deviceId) throw new AppError('DEVICE_MISMATCH', '设备标识不一致', 400)
    if (!limiter.allow(report.deviceId)) throw new AppError('RATE_LIMITED', '操作过于频繁，请稍后再试', 429)
    const accountId = await d.optionalUser(req)
    const stored = await d.store.ingest(report, { accountId })
    return { ok: true, nodes: stored.nodes }
  })

  app.get('/v1/admin/client-nodes', async (req) => { await d.admin(req); return d.query.listNodes(clientNodeListQuery.parse(req.query)) })
  app.get('/v1/admin/client-nodes/stats', async (req) => {
    const p = await d.admin(req)
    return { ...await d.query.stats(), canReveal: await d.isSuperAdmin(p) }
  })
  app.get('/v1/admin/client-nodes/changes', async (req) => { await d.admin(req); return d.query.changes(clientNodeChangesQuery.parse(req.query)) })
  app.get('/v1/admin/client-subs', async (req) => { await d.admin(req); return d.query.listSubs(clientSubListQuery.parse(req.query)) })

  const superAdmin = async (req: FastifyRequest) => {
    const p = await d.admin(req)
    if (!await d.isSuperAdmin(p)) throw new AppError('SUPER_ADMIN_REQUIRED', '只有超级管理员能查看', 403)
    return p
  }
  app.post('/v1/admin/client-nodes/reveal', async (req) => {
    const p = await superAdmin(req)
    const input = clientNodeRevealSchema.parse(req.body)
    const res = await d.query.revealNode(input.deviceId, input.nodeId).catch(async (e: unknown) => {
      await d.audit(p.userId, 'admin.client_node.reveal', 'client-node', `${input.deviceId}:${input.nodeId}`, req.ip, 'error', { deviceId: input.deviceId, nodeId: input.nodeId })
      throw e
    })
    await d.audit(p.userId, 'admin.client_node.reveal', 'client-node', `${input.deviceId}:${input.nodeId}`, req.ip, res.found ? (res.link ? 'success' : 'empty') : 'not_found', { deviceId: input.deviceId, nodeId: input.nodeId })
    if (!res.found) throw new AppError('NOT_FOUND', '节点不存在', 404)
    return { link: res.link }
  })
  app.post('/v1/admin/client-subs/reveal', async (req) => {
    const p = await superAdmin(req)
    const input = clientSubRevealSchema.parse(req.body)
    const res = await d.query.revealSub(input.deviceId, input.subId).catch(async (e: unknown) => {
      await d.audit(p.userId, 'admin.client_sub.reveal', 'client-sub', `${input.deviceId}:${input.subId}`, req.ip, 'error', { deviceId: input.deviceId, subId: input.subId })
      throw e
    })
    await d.audit(p.userId, 'admin.client_sub.reveal', 'client-sub', `${input.deviceId}:${input.subId}`, req.ip, res.found ? (res.link ? 'success' : 'empty') : 'not_found', { deviceId: input.deviceId, subId: input.subId })
    if (!res.found) throw new AppError('NOT_FOUND', '订阅不存在', 404)
    return { url: res.link }
  })

  if (!d.runRetention) return
  let running = false
  const purge = async () => {
    if (running) return
    running = true
    try {
      const removed = await d.store.purge(NODE_CHANGES_RETENTION_DAYS)
      if (removed.changes) d.log.info({ ...removed }, 'client node changes retention purge')
    } catch (error) {
      d.log.warn({ err: error instanceof Error ? error.message : 'purge failed' }, 'client node changes purge failed')
    } finally { running = false }
  }
  const timer = setInterval(() => void purge(), 60 * 60_000)
  timer.unref()
  setTimeout(() => void purge(), 90_000).unref()
  app.addHook('onClose', async () => clearInterval(timer))
}
