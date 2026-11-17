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

// ── 限流存储（Redis）与失败方向 ─────────────────────────────────────────────
// Redis 宕机时限流器自己不能变成故障点：全站默认放行（skipOnError，见 LIMITER_DEFAULTS），
// 只有「放行就等于被人白刷钱 / 白刷号」的接口（发短信、注册）拒绝服务，回 503 而不是 500。
// 用插件公开的自定义 store 接口：存储报错在这里统一成 AppError(503)，全局错误处理照常映射。

export type LimitRedis = { eval: (lua: string, numKeys: number, key: string, windowMs: number) => Promise<unknown> }
type IncrCallback = (error: Error | null, result?: { current: number; ttl: number }) => void
/** 插件运行时给 child() 的是「合并后的限流参数 + routeInfo」（类型声明写的是路由选项，两者都按 object 收）。 */
type RouteInfo = { routeInfo?: { method?: string | string[]; url?: string } }

/** 计数 +1；第一次（或键没有过期时间）时设窗口。返回 {当前次数, 剩余毫秒}。 */
const INCR_LUA = `local c=redis.call('INCR',KEYS[1])
local t=redis.call('PTTL',KEYS[1])
if c==1 or t<0 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) t=tonumber(ARGV[1]) end
return {c,t}`

export const limiterUnavailable = () => new AppError('RATE_LIMIT_UNAVAILABLE', '服务繁忙，请稍后再试', 503)

/** @fastify/rate-limit 的 store：键前缀 proxysplit:rl:（共享 Redis 必须带项目前缀）。 */
export function redisLimitStore(redis: LimitRedis) {
  return class RedisLimitStore {
    readonly prefix: string
    constructor(_options: object, prefix = 'proxysplit:rl:') { this.prefix = prefix }
    incr(key: string, callback: IncrCallback, timeWindow: number, _max?: number) {
      redis.eval(INCR_LUA, 1, this.prefix + key, timeWindow).then(
        raw => {
          const [current, ttl] = raw as [number, number]
          callback(null, { current: Number(current), ttl: Number(ttl) })
        },
        () => callback(limiterUnavailable()),
      )
    }
    child(options: object) {
      const { method, url } = (options as RouteInfo).routeInfo ?? {}
      return new RedisLimitStore(options, `${this.prefix}${[method].flat().join(',')}${url ?? ''}:`)
    }
  }
}

// ── 默认就限流（2026-11-18 第二轮审计）──────────────────────────────────────
// 以前 global:false：路由自己声明才限流，忘了声明就完全不限（lease、/v1/me、全部后台接口都是这样漏掉的）。
// 现在 global:true：没声明的路由共用一个「每 IP」默认桶（DEFAULT_LIMIT）——注意是共用，不是每条路由各一个桶。
// 所以三类路由必须自己声明，不能落进默认桶：
//   · 在线客户端定时调的 → FLEET_LIMIT（各有各的桶；落进共用桶的话，一个出口 IP 后的客户端会互相挤掉）
//   · 人手动触发、有被刷风险的 → 各自的低限额
//   · 支付回调 → CALLBACK_LIMIT；/health → NO_LIMIT
// 新加一条客户端会定时调的接口时，把它加进 rate-limits.test.ts 的 fleetRoutes，测试会拦住漏声明。

/** 没声明限额的路由共用：每 IP 每分钟。后台页面一次打开十来个请求、办公室一个出口多人同时用也远够不着。 */
export const DEFAULT_LIMIT = { max: 600, timeWindow: '1 minute' } as const
/**
 * 支付回调：来源是支付中心 / 网关的固定出口，集中到账时会成批到。不设成完全豁免，是因为这两个地址谁都能打，
 * 老网关回调验签之前要先查一次订单；额度给到正常峰值的许多倍，被限也只是对方稍后重试。
 */
export const CALLBACK_LIMIT = { max: 1200, timeWindow: '1 minute' } as const
/** 完全不限流（只给 /health：探活、负载均衡、部署脚本都在打，本身不碰数据库）。 */
export const NO_LIMIT = { rateLimit: false } as const

/** 插件全局默认：所有路由默认限流（DEFAULT_LIMIT），存储出错放行。 */
export const LIMITER_DEFAULTS = { global: true, ...DEFAULT_LIMIT, skipOnError: true } as const
/** 发短信 / 注册：存储出错不放行（合并进该路由的 rateLimit 配置）。 */
export const FAIL_CLOSED = { skipOnError: false } as const
