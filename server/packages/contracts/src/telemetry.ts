// 客户端日志上报（telemetry）合同：客户端 internal/telemetry 与这里一一对应，
// 事件目录见 docs/telemetry-events.md。只能加新类型 / 升 schemaVersion，不能改旧类型的含义。
import { z } from 'zod'

// 不从 index.ts 引分页 schema（index re-export 本文件，循环 import 会撞上未初始化）。
const paginationSchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export const TELEMETRY_SCHEMA_VERSION = 1

/** 已知事件类型（客户端可发更新的类型：服务端照存，类型名只校验格式）。 */
export const TELEMETRY_EVENT_TYPES = [
  'app.start','app.exit','app.crash','app.page_view','app.update_check','app.update','app.update_result',
  'proxy.start','proxy.stop','proxy.restart','tun.create','core.exit','core.fatal','core.update','net.blocked',
  'node.add','node.remove','node.select','node.latency','node.tcp','node.latency_all','node.speed',
  'sub.add','sub.update','sub.edit','sub.remove',
  'app_rule.change','custom_app.change','rule.change','ruleset.change','line.change','settings.change','mode.change',
  'diag.self_test','diag.route_test','diag.ai_env','diag.ai_env_fix',
  'account.login','account.logout','account.register','account.redeem','account.license','powervpn.nodes',
  'env.security','env.other_vpn','env.defender','proxy_port.change',
] as const

/** 归一化错误码（客户端 errcode.go）。 */
export const TELEMETRY_ERROR_CODES = [
  'CORE_START_FAIL','CORE_EXIT','TUN_CREATE_FAIL','CORE_BLOCKED_AV','DNS_FAIL','NODE_TIMEOUT','NODE_AUTH_FAIL',
  'NODE_UNREACHABLE','TLS_FAIL','PARSE_FAIL','SUB_FETCH_FAIL','NO_NODE','PORT_IN_USE','PERMISSION_DENIED',
  'CONFIG_INVALID','LICENSE_DENIED','NETWORK_FAIL','UPDATE_DOWNLOAD_FAIL','UPDATE_VERIFY_FAIL','PANIC','UNKNOWN',
] as const

export const telemetryStatus = z.enum(['ok','fail','info'])
export const telemetryDeviceId = z.string().regex(/^[0-9a-f]{64}$/)

export const telemetryEventSchema = z.object({
  eventId: z.string().uuid(),
  sessionId: z.string().min(1).max(64),
  seq: z.number().int().min(0).max(1e12),
  ts: z.string().datetime({ offset: true }),
  type: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/).max(64),
  status: telemetryStatus,
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,47}$/).optional(),
  errorText: z.string().max(4000).optional(),
  payload: z.record(z.unknown()).nullable().default({}),
})

export const telemetryLogChunkSchema = z.object({
  chunkId: z.string().uuid(),
  sessionId: z.string().min(1).max(64),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  lineCount: z.number().int().min(0).max(100_000),
  text: z.string().max(1_000_000),
})

export const telemetryBatchSchema = z.object({
  schemaVersion: z.number().int().min(1).max(100),
  deviceId: telemetryDeviceId,
  appVersion: z.string().max(40).default(''),
  coreVersion: z.string().max(120).optional(),
  os: z.string().max(160).optional(),
  arch: z.string().max(20).optional(),
  accountHint: z.string().max(120).optional(),
  events: z.array(telemetryEventSchema).max(2000).default([]),
  logs: z.array(telemetryLogChunkSchema).max(50).default([]),
})

const isoParam = z.string().datetime({ offset: true }).optional()

export const telemetryDeviceListQuery = paginationSchema.extend({
  version: z.string().trim().max(40).optional(),
  lastStatus: telemetryStatus.optional(),
  account: z.string().trim().max(120).optional(),
  from: isoParam,
  to: isoParam,
})

export const telemetryEventListQuery = paginationSchema.extend({
  type: z.string().trim().max(64).optional(),
  status: telemetryStatus.optional(),
  errorCode: z.string().trim().max(48).optional(),
  from: isoParam,
  to: isoParam,
})

/** 日志搜索：ILIKE 只在有限时间窗里做（默认最近 24 小时，最长 7 天）。 */
export const telemetryLogQuery = paginationSchema.extend({
  from: isoParam,
  to: isoParam,
})

export const telemetryFailureQuery = paginationSchema.extend({
  days: z.coerce.number().int().min(1).max(60).default(7),
  type: z.string().trim().max(64).optional(),
  version: z.string().trim().max(40).optional(),
})

export const telemetryAnalyticsQuery = z.object({
  days: z.coerce.number().int().min(1).max(60).default(7),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

export type TelemetryBatch = z.infer<typeof telemetryBatchSchema>
export type TelemetryEventInput = z.infer<typeof telemetryEventSchema>
export type TelemetryDeviceListQuery = z.infer<typeof telemetryDeviceListQuery>
export type TelemetryEventListQuery = z.infer<typeof telemetryEventListQuery>
export type TelemetryLogQuery = z.infer<typeof telemetryLogQuery>
export type TelemetryFailureQuery = z.infer<typeof telemetryFailureQuery>
export type TelemetryAnalyticsQuery = z.infer<typeof telemetryAnalyticsQuery>
