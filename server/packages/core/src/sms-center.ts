// 短信验证码走公司雷池验证中心 leichiwaf-verify（业主 2026-11-17，与开箱站同一套，参考实现 V7）。
// 发码 / 核码 / 冷却 / 限额 / 通道凭据都在中心；本站只接公司包 yanzheng/verify-client（vendor 在 ./vendor/yanzheng）的 createSiteOtp。
// 文案一律用 SDK 默认值；本文件只把 SDK 结果翻成本项目的 AppError（错误码给客户端判断用）。
// 说明：docs/memory/account-membership.md「短信验证码走雷池验证中心」。
import { AsyncLocalStorage } from 'node:async_hooks'
import { AppError, maskPhone } from '@proxysplit/shared'
import type { SmsPurpose } from '@proxysplit/contracts'
import { createSecurityClient, createSiteOtp, type OtpCheckResult, type OtpSendResult, type SecurityClient, type SiteOtp, type SiteOtpKv } from './vendor/yanzheng/verify-client/index.js'

/** 本站在共享 Redis 里的键前缀（只许 proxysplit:*） */
export const LCV_KEY_PREFIX = 'proxysplit:lcvotp:'
/** 已发版老客户端（≤ v1.12.4）发码不带人机凭证：给一句看得懂的话 */
export const SMS_UPGRADE_MESSAGE = '请升级到最新版本后再获取验证码'
/** 浏览器里缓存的旧官网页面发码同样不带凭证字段：让用户刷新页面，而不是「升级」 */
export const SMS_REFRESH_MESSAGE = '请刷新页面后重试'
/** 找回密码发码：已注册 / 未注册对外同一句话（防枚举） */
export const RESET_SENT_MESSAGE = '若该手机号已绑定账号，验证码已发送，5 分钟内有效'
/** 找回发码两条路统一最短耗时：必须大于 SDK 单次调用超时（2 秒） */
export const RESET_SEND_MIN_MS = 2500
const DEFAULT_COOLDOWN = 60

/** ioredis 用到的那几个方法（core 不直接依赖 ioredis） */
export type SmsCenterRedis = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ex: 'EX', ttlSec: number): Promise<unknown>
  del(key: string): Promise<unknown>
  incr(key: string): Promise<number>
  expire(key: string, ttlSec: number): Promise<unknown>
}
/**
 * SDK 要的 KV，只用最基本的命令（共享 Redis 的 ACL 账号不一定放行脚本 / GETDEL）。
 * incr 本身原子（SDK 靠它「先占名额再比对」）；首次自增后补过期，万一补不上，下次发码 / 暂存会删掉这个计数键。
 */
export const smsCenterKv = (r: SmsCenterRedis): SiteOtpKv => ({
  get: k => r.get(k),
  set: (k, v, ttl) => r.set(k, v, 'EX', Math.max(1, Math.floor(ttl))),
  del: k => r.del(k),
  getdel: async k => { const v = await r.get(k); if (v !== null) await r.del(k); return v },
  incr: async (k, ttl) => { const n = await r.incr(k); if (n === 1) await r.expire(k, Math.max(1, Math.floor(ttl))); return n },
})

export type SmsCenterOptions = {
  siteId: string
  /** 本站域名：人机凭证按它绑定，必须就是出滑块的那个页面的域名 */
  host: string
  secret: string
  /** 中心签名端口；容器里走宿主桥接地址（如 http://172.20.0.1:18977） */
  baseUrl?: string | undefined
  redis: SmsCenterRedis
  log?: ((msg: string) => void) | undefined
  /** 测试缝：换掉中心客户端 */
  client?: SecurityClient
  /** 测试缝：找回发码的最短耗时 */
  resetSendMinMs?: number
}
export type SmsSendContext = {
  /** undefined = 请求里根本没有这个字段（老客户端）；'' = 新客户端没拿到凭证 */
  captchaTicket?: string | undefined
  /** 用户真实 IP（中心必填） */
  clientIp: string
  deviceFp?: string | null | undefined
  /** 请求来自浏览器页面（带 Origin 头）；客户端的请求由 Go 发出，不带 */
  web?: boolean | undefined
}
export type SmsSent = { ok: true; cooldownSeconds: number; message?: string }

/**
 * SDK 发码结果 → AppError。人机凭证的所有失败只用一个错误码 CAPTCHA_REQUIRED（客户端据此重新弹验证）：
 * 找回发码的「已注册 / 未注册」两条路都会报它，分成两个码就成了探号口子。
 */
export function sendFailure(r: OtpSendResult): AppError {
  switch (r.code) {
    case 'captcha': return new AppError('CAPTCHA_REQUIRED', r.message, 403)
    case 'cooldown': return new AppError('SMS_COOLDOWN', r.message, 429, { cooldownSeconds: r.retryAfterSec ?? DEFAULT_COOLDOWN })
    case 'quota': return new AppError('SMS_DAILY_LIMIT', r.message, 429)
    case 'blocked-prefix': return new AppError('SMS_BLOCKED_PREFIX', r.message, 400)
    case 'bad-recipient': return new AppError('SMS_BAD_RECIPIENT', r.message, 400)
    case 'refused': return new AppError('PHONE_TAKEN', r.message, 409)
    case 'busy': return new AppError('SMS_BUSY', r.message, 503)
    default: return r.centerError === 'CHANNEL_NOT_CONFIGURED' ? new AppError('SMS_UNAVAILABLE', r.message, 503) : new AppError('SMS_SEND_FAILED', r.message, 502)
  }
}
/** SDK 核码结果 → AppError：中心不可用是 SMS_BUSY（码没烧，稍后原码重试），其余都是 SMS_CODE_INVALID。 */
export function checkFailure(r: OtpCheckResult): AppError {
  return r.code === 'busy' ? new AppError('SMS_BUSY', r.message, 503) : new AppError('SMS_CODE_INVALID', r.message, 400)
}

export class SmsCenter {
  private otp: SiteOtp
  private log: (msg: string) => void
  private minMs: number
  /** 当前这次发码的打码手机号，带进 SDK 自己打的日志里（SDK 的日志不带号码） */
  private scope = new AsyncLocalStorage<string>()
  constructor(o: SmsCenterOptions) {
    this.log = o.log ?? (() => {})
    this.minMs = o.resetSendMinMs ?? RESET_SEND_MIN_MS
    const client = o.client ?? createSecurityClient({ siteId: o.siteId, secret: o.secret, host: o.host, ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}) })
    const kv = smsCenterKv(o.redis)
    this.otp = createSiteOtp({
      client: () => client, kv: () => kv, keyPrefix: LCV_KEY_PREFIX, stashSecret: o.secret,
      log: (level, msg, meta) => this.log(`[${level}] sms center ${msg} phone=${this.scope.getStore() ?? '-'}${meta ? ' ' + JSON.stringify(meta) : ''}`),
    })
  }
  private input(phone: string, purpose: SmsPurpose, c: SmsSendContext) {
    return { channel: 'sms' as const, to: phone, purpose, captchaTicket: c.captchaTicket ?? '', clientIp: c.clientIp, ...(c.deviceFp ? { deviceFp: c.deviceFp } : {}) }
  }
  private outcome(phone: string, purpose: SmsPurpose, r: OtpSendResult, message?: string): SmsSent {
    if (!r.ok) {
      // 只记结果种类 + 打码手机号；验证码、凭证、密钥都不进日志
      this.log(`[warn] sms center send failed purpose=${purpose} phone=${maskPhone(phone)} result=${r.code}${r.centerError ? ' center=' + r.centerError : ''}${r.bucket ? ' bucket=' + r.bucket : ''}${r.reason ? ' reason=' + r.reason : ''}`)
      throw sendFailure(r)
    }
    return { ok: true, cooldownSeconds: r.retryAfterSec && r.retryAfterSec > 0 ? Math.ceil(r.retryAfterSec) : DEFAULT_COOLDOWN, message: message ?? r.message }
  }
  private guardOldClient(c: SmsSendContext) {
    if (c.captchaTicket !== undefined) return
    throw c.web ? new AppError('PAGE_REFRESH_REQUIRED', SMS_REFRESH_MESSAGE, 400) : new AppError('CLIENT_UPGRADE_REQUIRED', SMS_UPGRADE_MESSAGE, 400)
  }
  /**
   * 注册 / 绑定发码：过了人机验证就对每个号照常发，不在这一步说「已注册 / 已被占用」
   * （那只在注册 / 绑定提交、核码之后才说，否则发码接口就是探号口子）。
   */
  async send(phone: string, purpose: 'register' | 'bind', c: SmsSendContext): Promise<SmsSent> {
    this.guardOldClient(c)
    return this.scope.run(maskPhone(phone) ?? '-', async () => this.outcome(phone, purpose, await this.otp.send(this.input(phone, purpose, c))))
  }
  /** 找回密码发码：没注册的号只核人机凭证、不发码；两条路同一句话、同样耗时。 */
  async sendReset(phone: string, c: SmsSendContext, exists: () => Promise<boolean>): Promise<SmsSent> {
    this.guardOldClient(c)
    return this.scope.run(maskPhone(phone) ?? '-', async () =>
      this.outcome(phone, 'reset', await this.otp.sendIfExists(this.input(phone, 'reset', c), exists, { generic: RESET_SENT_MESSAGE, minMs: this.minMs }), RESET_SENT_MESSAGE))
  }
  /**
   * 核码。consume=false 只读（对了也不作废，之后还能用同一个码消费）；consume=true 真正消费（在线核销，只成功一次）。
   * 顺序固定：只读核码 → 其它闸门 → 消费 → 写库（被闸门拒掉的人码不会被烧掉）。
   */
  async check(phone: string, purpose: SmsPurpose, code: string, consume: boolean): Promise<void> {
    const r = await this.scope.run(maskPhone(phone) ?? '-', () => this.otp.check('sms', phone, purpose, code, consume))
    if (r.ok) return
    if (r.code === 'busy') this.log(`[warn] sms center check unavailable purpose=${purpose} phone=${maskPhone(phone)} consume=${consume}`)
    throw checkFailure(r)
  }
}

export type SmsCenterEnv = { LCV_SITE_ID?: string | undefined; LCV_HOST?: string | undefined; LCV_SITE_SECRET?: string | undefined; LCV_URL?: string | undefined }
/** LCV_SITE_ID / LCV_HOST / LCV_SITE_SECRET 三项都配了 = 中心模式；都没配 = 本地模式（返回 null）。只配一部分在 config.ts 启动时就报错。 */
export function createSmsCenterFromEnv(env: SmsCenterEnv, redis: SmsCenterRedis | undefined, log?: (msg: string) => void): SmsCenter | null {
  if (!env.LCV_SITE_ID || !env.LCV_HOST || !env.LCV_SITE_SECRET) return null
  if (!redis) throw new Error('LCV_* is configured but REDIS_URL is missing (the verification center needs Redis)')
  return new SmsCenter({ siteId: env.LCV_SITE_ID, host: env.LCV_HOST, secret: env.LCV_SITE_SECRET, baseUrl: env.LCV_URL, redis, log })
}
