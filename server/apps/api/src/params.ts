// 路径参数里的记录 id（users / devices / plans / redeem_codes / releases / 云端配置……库里都是 uuid 列）。
// 全站一个解析器：不是 uuid 形状的 id 直接 404（「没有这条记录」），不让它走到 SQL 里变成 22P02 → 500。
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { AppError } from '@proxysplit/shared'

const recordId = z.guid()

/** 取 req.params[key] 并校验；notFound = 404 文案（各资源自己的说法）。 */
export function idParam(req: FastifyRequest, notFound = '资源不存在', key = 'id'): string {
  const parsed = recordId.safeParse((req.params as Record<string, unknown> | undefined)?.[key])
  if (!parsed.success) throw new AppError('NOT_FOUND', notFound, 404)
  return parsed.data
}
