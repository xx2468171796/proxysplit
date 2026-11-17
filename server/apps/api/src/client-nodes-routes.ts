// 同事节点上报：POST /v1/client/nodes（客户端）+ /v1/admin/client-nodes|client-subs/*（后台）+ 变化记录保留期清理。
// 合同 docs/节点上报.md / @proxysplit/contracts client-nodes.ts，入库 / 查询在 core client-nodes-store.ts / client-nodes-query.ts。
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from '@proxysplit/shared'
import { clientNodeChangesQuery, clientNodeListQuery, clientNodeReportSchema, clientNodeRevealSchema, clientSubListQuery, clientSubRevealSchema } from '@proxysplit/contracts'
import type { ClientNodesQuery, ClientNodesStore } from '@proxysplit/core'
import { DeviceLimiter, gzipPreParsing } from './telemetry-routes.js'
import type { IpByteBudget } from './telemetry-budget.js'
import { FLEET_LIMIT } from './rate-limits.js'

/** 解压后单次上报上限（docs/节点上报.md：≤ 2 MB）。 */
export const NODES_MAX_BODY_BYTES = 2 * 1024 * 1024
export const NODE_CHANGES_RETENTION_DAYS = 90
/** 还标着在用、但设备这么多天没再上报的节点 / 订阅行，清理时删掉。 */
export const NODE_STALE_RETENTION_DAYS = 90
/** 每 IP 每 10 分钟最多收多少字节（解压后）；公司一个出口后几十台机器各报几次绰绰有余。 */
export const NODES_IP_BYTES_PER_10MIN = 64 * 1024 * 1024

/** 不是员工账号（或没登录、设备对不上）的上报：照样回 200，但什么都不存。 */
export const IGNORED_REPORT = { ok: true, nodes: 0 } as const

type Principal = { userId: string; role: string }
type Audit = (actor: string, action: string, targetType: string, targetId: string, ip: string, result: string, metadata?: Record<string, unknown>) => Promise<void>
export type ClientNodesDeps = {
  store: Pick<ClientNodesStore, 'ingest' | 'purge'>
  query: Pick<ClientNodesQuery, 'listNodes' | 'listSubs' | 'changes' | 'stats' | 'revealNode' | 'revealSub'>
  /**
   * 谁能上报（唯一判定）：请求带着员工账号（users.staff）的有效访问令牌，且令牌绑定的设备就是 deviceId 这台 → 返回账号 id；
   * 其余（没令牌 / 令牌失效 / 不是员工 / 设备对不上）一律 null。
   */
  staffReporter: (req: FastifyRequest, deviceId: string) => Promise<string | null>
  admin: (req: FastifyRequest) => Promise<Principal>
  /** 当前管理员是不是超管（能解密链接）。 */
  isSuperAdmin: (p: Principal) => Promise<boolean>
  audit: Audit
  perDevicePerMinute: number
  /** 每 IP 字节预算（telemetry-budget.ts）：只限量，谁能上报由 staffReporter 管。 */
  ipBudget: IpByteBudget
  runRetention: boolean
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void }
}

export function registerClientNodesRoutes(app: FastifyInstance, d: ClientNodesDeps) {
  const limiter = new DeviceLimiter(d.perDevicePerMinute)
  const reporters = new WeakMap<FastifyRequest, string>()
  // 读请求体之前先认人（设备号看 X-Device-Id 头，后面再核对它与请求体一致）。不是员工 → 直接回 200、不读也不存：
  // 已发布的客户端人人都在报，而且把非 2xx 当成「稍后重试」（30 秒起退避、永不放弃）——回 4xx 等于让全网客户端一直重试；
  // 回 200 它就记为已送达，之后只在清单变化 / 每 6 小时保活时再发一次小请求。
  // 回调写法：不放行的请求不调 done，生命周期就停在这里；放行的才继续解压、解析。
  const staffGate = (req: FastifyRequest, reply: FastifyReply, _payload: unknown, done: (err?: Error | null) => void) => {
    d.staffReporter(req, String(req.headers['x-device-id'] ?? '')).then(accountId => {
      if (!accountId) { void reply.code(200).send(IGNORED_REPORT); return }
      reporters.set(req, accountId)
      done()
    }, (error: unknown) => done(error instanceof Error ? error : new Error('staff check failed')))
  }
  app.post('/v1/client/nodes', {
    bodyLimit: NODES_MAX_BODY_BYTES,
    config: { rateLimit: FLEET_LIMIT }, // 每台在线客户端都会调（绝大多数被上面直接回 200）：按 IP 用 FLEET_LIMIT
    preParsing: [staffGate, gzipPreParsing(NODES_MAX_BODY_BYTES)],
  }, async (req) => {
    const accountId = reporters.get(req)
    if (!accountId) return IGNORED_REPORT
    const report = clientNodeReportSchema.parse(req.body)
    const header = String(req.headers['x-device-id'] ?? '')
    if (header !== report.deviceId) throw new AppError('DEVICE_MISMATCH', '设备标识不一致', 400)
    if (!limiter.allow(report.deviceId)) throw new AppError('RATE_LIMITED', '操作过于频繁，请稍后再试', 429)
    if (!await d.ipBudget.charge(req.ip, Buffer.byteLength(JSON.stringify(req.body)))) throw new AppError('RATE_LIMITED', '上报数据过多，请稍后再试', 429)
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
      const removed = await d.store.purge(NODE_CHANGES_RETENTION_DAYS, { staleDays: NODE_STALE_RETENTION_DAYS })
      if (removed.changes || removed.staleRows) d.log.info({ ...removed }, 'client node changes retention purge')
    } catch (error) {
      d.log.warn({ err: error instanceof Error ? error.message : 'purge failed' }, 'client node changes purge failed')
    } finally { running = false }
  }
  const timer = setInterval(() => void purge(), 60 * 60_000)
  timer.unref()
  setTimeout(() => void purge(), 90_000).unref()
  app.addHook('onClose', async () => clearInterval(timer))
}
