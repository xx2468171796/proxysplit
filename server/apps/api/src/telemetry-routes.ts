// 客户端日志上报：POST /v1/client/telemetry（客户端）+ /v1/admin/telemetry/*（后台）+ 保留期清理定时器。
// 合同在 @proxysplit/contracts telemetry.ts，入库 / 查询在 core telemetry-store.ts / telemetry-query.ts。
import { createGunzip } from 'node:zlib'
import type { Transform } from 'node:stream'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AppError } from '@proxysplit/shared'
import { telemetryAnalyticsQuery, telemetryBatchSchema, telemetryDeviceId, telemetryDeviceListQuery, telemetryEventListQuery, telemetryFailureQuery, telemetryLogQuery } from '@proxysplit/contracts'
import type { TelemetryQuery, TelemetryStore } from '@proxysplit/core'
import type { IpByteBudget } from './telemetry-budget.js'

/** 解压后单次上报上限（客户端一段 256 KB，留足余量）。 */
export const TELEMETRY_MAX_BODY_BYTES = 4 * 1024 * 1024

type Principal = { userId: string; role: string }
export type TelemetryDeps = {
  store: Pick<TelemetryStore, 'ingest' | 'purge'>
  query: Pick<TelemetryQuery, 'listDevices' | 'getDevice' | 'listEvents' | 'searchLogs' | 'failures' | 'analytics'>
  /** 可选身份：有效令牌 → 账号；没有 / 过期 → null（照样收，按设备限流）。 */
  optionalUser: (req: FastifyRequest) => Promise<string | null>
  admin: (req: FastifyRequest) => Promise<Principal>
  retentionDays: number
  maxGzipBytes: number
  perDevicePerMinute: number
  /** 每 IP 每 10 分钟最多收多少字节（解压后）。 */
  ipBudget: IpByteBudget
  runRetention: boolean
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void }
}

/** 每台设备每分钟最多 N 次（单进程内存计数，表大小有上限，每分钟清零）。 */
export class DeviceLimiter {
  private window = 0
  private counts = new Map<string, number>()
  constructor(private readonly max: number, private readonly cap = 50_000, private readonly now = () => Date.now()) {}
  allow(key: string): boolean {
    const w = Math.floor(this.now() / 60_000)
    if (w !== this.window || this.counts.size > this.cap) { this.window = w; this.counts.clear() }
    const n = (this.counts.get(key) ?? 0) + 1
    this.counts.set(key, n)
    return n <= this.max
  }
}

/** Content-Encoding: gzip 的上报体：边收边解压，压缩前超过 maxGzipBytes 直接 413（解压后上限靠路由 bodyLimit）。 */
export function gzipPreParsing(maxGzipBytes: number) {
  return async (req: FastifyRequest, _reply: unknown, payload: NodeJS.ReadableStream & { on: (e: 'data', f: (c: Buffer) => void) => unknown }) => {
    if (Number(req.headers['content-length'] ?? 0) > maxGzipBytes) throw new AppError('PAYLOAD_TOO_LARGE', '上报数据过大', 413)
    if (req.headers['content-encoding'] !== 'gzip') return payload
    const gz = createGunzip() as Transform & { receivedEncodedLength?: number }
    let received = 0
    gz.receivedEncodedLength = 0
    payload.on('data', (c: Buffer) => {
      received += c.length
      gz.receivedEncodedLength = received
      if (received > maxGzipBytes) gz.destroy(new AppError('PAYLOAD_TOO_LARGE', '上报数据过大', 413))
    })
    payload.pipe(gz)
    return gz
  }
}

const deviceParam =(req: FastifyRequest) => {
  const parsed = telemetryDeviceId.safeParse((req.params as { id?: string }).id)
  if (!parsed.success) throw new AppError('NOT_FOUND', '设备不存在', 404)
  return parsed.data
}

export function registerTelemetryRoutes(app: FastifyInstance, d: TelemetryDeps) {
  const limiter = new DeviceLimiter(d.perDevicePerMinute)
  app.post('/v1/client/telemetry', {
    bodyLimit: TELEMETRY_MAX_BODY_BYTES, // 解压后上限；压缩前上限在 preParsing 里按 maxGzipBytes 查
    config: { rateLimit: { max: 240, timeWindow: '1 minute' } }, // 每 IP（公司 NAT 后多台机器）
    preParsing: gzipPreParsing(d.maxGzipBytes),
  }, async (req) => {
    const header = String(req.headers['x-device-id'] ?? '')
    const batch = telemetryBatchSchema.parse(req.body)
    if (header && header !== batch.deviceId) throw new AppError('DEVICE_MISMATCH', '设备标识不一致', 400)
    if (!limiter.allow(batch.deviceId)) throw new AppError('RATE_LIMITED', '操作过于频繁，请稍后再试', 429)
    if (!await d.ipBudget.charge(req.ip, Buffer.byteLength(JSON.stringify(req.body)))) throw new AppError('RATE_LIMITED', '上报数据过多，请稍后再试', 429)
    // 账号绑定 / 设备字段能不能改由 store 按「令牌账号 vs 设备已有账号」判断，见 telemetry-store.ts
    const accountId = await d.optionalUser(req)
    const stored = await d.store.ingest(batch, { accountId, ip: req.ip })
    return { ok: true, ...stored }
  })

  app.get('/v1/admin/telemetry/devices', async (req) => { await d.admin(req); return d.query.listDevices(telemetryDeviceListQuery.parse(req.query)) })
  app.get('/v1/admin/telemetry/devices/:id', async (req) => {
    await d.admin(req)
    const row = await d.query.getDevice(deviceParam(req))
    if (!row) throw new AppError('NOT_FOUND', '设备不存在', 404)
    return row
  })
  app.get('/v1/admin/telemetry/devices/:id/events', async (req) => { await d.admin(req); return d.query.listEvents(deviceParam(req), telemetryEventListQuery.parse(req.query)) })
  app.get('/v1/admin/telemetry/devices/:id/logs', async (req) => { await d.admin(req); return d.query.searchLogs(deviceParam(req), telemetryLogQuery.parse(req.query)) })
  app.get('/v1/admin/telemetry/failures', async (req) => { await d.admin(req); return d.query.failures(telemetryFailureQuery.parse(req.query)) })
  app.get('/v1/admin/telemetry/analytics', async (req) => { await d.admin(req); return d.query.analytics(telemetryAnalyticsQuery.parse(req.query)) })

  if (!d.runRetention) return
  let running = false
  const purge = async () => {
    if (running) return
    running = true
    try {
      const removed = await d.store.purge(d.retentionDays)
      if (removed.events || removed.logs || removed.devices) d.log.info({ ...removed, retentionDays: d.retentionDays }, 'telemetry retention purge')
    } catch (error) {
      d.log.warn({ err: error instanceof Error ? error.message : 'purge failed' }, 'telemetry retention purge failed')
    } finally { running = false }
  }
  const timer = setInterval(() => void purge(), 60 * 60_000)
  timer.unref()
  setTimeout(() => void purge(), 60_000).unref()
  app.addHook('onClose', async () => clearInterval(timer))
}
