// 同事节点上报合同（docs/节点上报.md）：客户端 internal/nodereport 与这里字段一一对应。
// 只加字段不改含义；客户端多发的未知字段直接忽略。
import { z } from 'zod'
import { telemetryDeviceId } from './telemetry.js'

export const NODE_REPORT_SCHEMA_VERSION = 1

const str = (max: number) => z.string().max(max).default('')
const num = z.number().finite().default(0)

export const clientNodeSchema = z.object({
  id: z.string().min(1).max(128),
  name: str(200),
  type: str(32),
  server: str(255),
  port: z.number().int().min(0).max(65535).default(0),
  network: str(32),
  security: str(32),
  sni: str(255),
  core: str(32),
  via: str(128),
  subId: str(128),
  official: z.boolean().default(false),
  source: str(32),
  latency: num,
  tcpLatency: num,
  speed: num,
  link: z.string().max(200_000).default(''),
})

export const clientSubSchema = z.object({
  id: z.string().min(1).max(128),
  name: str(200),
  url: z.string().max(4000).default(''),
  host: str(255),
  nodeCount: z.number().int().min(0).max(1_000_000).default(0),
  autoUpdate: z.boolean().default(false),
  lastUpdate: z.string().datetime({ offset: true }).nullable().optional().catch(null),
})

export const clientNodeReportSchema = z.object({
  schemaVersion: z.number().int().min(1).max(100),
  deviceId: telemetryDeviceId,
  appVersion: str(40),
  accountHint: z.string().max(120).optional(),
  reason: z.string().max(20).default(''),
  selectedId: z.string().max(128).default(''),
  nodes: z.array(clientNodeSchema).max(5000).default([]),
  subs: z.array(clientSubSchema).max(500).default([]),
})

const page = z.coerce.number().int().min(1).max(100_000).default(1)
const pageSize = z.coerce.number().int().min(1).max(200).default(50)

export const clientNodeListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  type: z.string().trim().max(32).optional(),
  deviceId: z.string().trim().max(64).optional(),
  accountId: z.string().uuid().optional(),
  status: z.enum(['alive', 'removed', 'all']).default('alive'),
  dead: z.preprocess(v => v === '1' || v === 'true' || v === true, z.boolean()).optional(),
  page,
  pageSize,
})

export const clientNodeChangesQuery = z.object({
  deviceId: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const clientSubListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  deviceId: z.string().trim().max(64).optional(),
  page,
  pageSize,
})

export const clientNodeRevealSchema = z.object({ deviceId: telemetryDeviceId, nodeId: z.string().min(1).max(128) })
export const clientSubRevealSchema = z.object({ deviceId: telemetryDeviceId, subId: z.string().min(1).max(128) })

export type ClientNodeReport = z.infer<typeof clientNodeReportSchema>
export type ClientNodeInput = z.infer<typeof clientNodeSchema>
export type ClientSubInput = z.infer<typeof clientSubSchema>
export type ClientNodeListQuery = z.infer<typeof clientNodeListQuery>
export type ClientNodeChangesQuery = z.infer<typeof clientNodeChangesQuery>
export type ClientSubListQuery = z.infer<typeof clientSubListQuery>
