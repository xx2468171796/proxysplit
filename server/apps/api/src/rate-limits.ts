// 限流口径（全站一处）。按 IP 的限流分两类：
// 1. 正在运行的客户端「定时」调用的接口（刷新令牌每 60 秒一次、租约、设备 / 订单查询、配置同步、日志上报、通知轮询）：
//    公司 / 网吧 / 校园网一个出口 IP 后面可以有上百台客户端，按 IP 给低限额会让诚实用户吃 429，
//    而老版本客户端把刷新接口的任何 4xx 都当成「授权被吊销」→ 掉登录。这类接口统一用 FLEET_LIMIT，
//    真正的滥用控制放在更细的键上（会话 family、设备号、字节预算）。
// 2. 人手动触发、且有被刷风险的接口（登录、注册、发短信、下单、改密）：保持各自的低限额。
import { AppError } from '@proxysplit/shared'

/** 每 IP 每分钟：够 600 台客户端同一出口各调一次，仍能挡住单机死循环。 */
export const FLEET_LIMIT = { max: 600, timeWindow: '1 minute' } as const

/** 同一条会话（refresh token family）每分钟最多刷新几次：正常 1 次，留足重试余量。 */
export const REFRESH_PER_FAMILY_PER_MINUTE = 30

/** 刷新令牌里的 family（不验签，只当限流的键用；验签在 AuthService.rotate）。不是 JWT 形状 = null。 */
export function refreshFamilyKey(token: string): string | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const fam = (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { fam?: unknown }).fam
    return typeof fam === 'string' && fam.length > 0 && fam.length <= 64 ? fam : null
  } catch { return null }
}

export const rateLimited = () => new AppError('RATE_LIMITED', '操作过于频繁，请稍后再试', 429)
