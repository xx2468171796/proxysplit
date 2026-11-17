// 会员收款走公司统一支付中心 zhifu-service（PAY_MODE=center）：公司包 zhifu 的 zhifu/site（vendor 在 ./vendor/zhifu）。
// 中心决定通道（目前微信 zyg1103wx）、排队、未付规则、拆单；本站只建一笔本地订单、签名下单、收签名回调。
// 发放 = store.fulfillPaidOrder（payment_events 去重，恰好一次）：签名回调 onPaid 是主路，至少送达一次；
// 查单发现中心已付而本地未付时走同一落地点补发（PaymentService.syncCenterOrder），并把过期单标失败。
// 红线：不把本站域名 / 站名带上游 —— subject 用 SDK 默认「充值」，不传站名。
import { createHash } from 'node:crypto'
import { AppError } from '@proxysplit/shared'
import { createPayClient } from './vendor/zhifu/center/client.js'
import { createSitePay, type CenterSideOptions, type SitePayEnv } from './vendor/zhifu/site/index.js'
import { redeemHumanToken, type HumanVerdict } from './vendor/zhifu/site/human-verify.js'
import type { PaidEvent, SiteCreateResult, SitePay, SitePayFailCode } from './vendor/zhifu/site/types.js'
import { localOrderNoOf, pgCenterDedupe, pgCenterOrderBook, type Queryable } from './pay-center-book.js'

/** 下单时能拿到的玩家上下文（全部可选，有就传，中心的风控规则都读它）。 */
export type CenterPayContext = {
  username?: string; nickname?: string | null; phone?: string | null; clientIp?: string;
  userAgent?: string; deviceFingerprint?: string | null; accountCreatedAt?: Date | string | null;
  /** 付款前人机验证（LcVerify action=pay）的一次性凭证；由 SDK 的 redeemHumanToken 兑换，本站不自己判。 */
  hvToken?: string;
}
/** 兑换一次凭证：SDK redeemHumanToken（生产）或测试替身。 */
export type HvRedeem = (token: string) => Promise<HumanVerdict>
export type CenterLocalOrder = { orderNo: string; userId: string; amountCents: number }
export type CenterOrderLink = { siteOrderNo: string; payUrl: string; checkoutUrl: string | null; expireAt: string; localOrderNo: string }
/** 中心还回旧未付单时问调用方：那笔旧本地订单能不能顶替这次的新单（同人同套餐同金额才行）。 */
export type AcceptReuse = (reusedLocalOrderNo: string) => Promise<boolean>
/** paid：中心说已付时，按订单簿（用户 / 金额）拼出的付款事件，事件号与签名回调相同（两条路在 payment_events 互相去重）。 */
export type CenterOrderState = { status: 'pending' | 'paid' | 'expired' | 'cancelled'; siteOrderNo: string; paid: PaidEvent | null } | null
type CenterBook = ReturnType<typeof pgCenterOrderBook>

/** 拒单码 → HTTP 状态与兜底文案（中心给的 message 优先原样显示，它带等待时间 / 原因）。 */
const REFUSALS: Record<SitePayFailCode, [number, string]> = {
  COOLDOWN: [429, '下单太频繁，请稍后再试'],
  QUEUE_FULL: [429, '当前付款人数较多，请稍后再试'],
  QUEUED: [429, '当前付款人数较多，正在排队，请稍后再点购买'],
  CHALLENGE_REQUIRED: [403, '请先完成安全验证再购买（旧版客户端请先升级）'],
  PAY_BANNED: [403, '付款功能已暂停，请联系客服'],
  AMOUNT_INVALID: [400, '订单金额不在可支付范围内，请联系客服'],
  COLLECTION_OFF: [503, '充值通道维护中，请稍后再试或联系客服'],
  CHANNEL_BUSY: [503, '支付通道繁忙，请稍后再试'],
  OUTAGE: [503, '支付通道异常，请稍后再试或联系客服'],
  OPEN_ORDER: [409, '你还有一笔未完成的订单，请先完成或等它过期'],
  TRUST_REQUIRED: [403, '请先绑定手机号后再购买'],
  ERROR: [502, '支付下单失败，请稍后再试'],
}
export function centerRefusal(code: SitePayFailCode, message: string | undefined): AppError {
  const [status, fallback] = REFUSALS[code] ?? REFUSALS.ERROR
  return new AppError(`PAY_${code}`, message?.trim() || fallback, status)
}

export type CenterFulfil = (e: PaidEvent, localOrderNo: string) => Promise<void>
/** 中心退款回调（已按订单簿核过用户）：refundedCents = 这笔订单累计已退，amountCents = 订单金额。 */
export type CenterRefundEvent = { siteOrderNo: string; localOrderNo: string; refundedCents: number; amountCents: number; refundNo: string | null }
export type CenterRefund = (e: CenterRefundEvent) => Promise<void>
/** PaymentService 给中心适配器的两个落地点：付款发放、退款收回。 */
export type CenterHooks = { onPaid: CenterFulfil; onRefunded: CenterRefund }

export class CenterPay {
  /** 人机验证服务不可达而放行的次数（进程内累计，给日志 / 排障看）。 */
  readonly stats = { hvUnavailable: 0 }
  constructor(private pay: SitePay, private book: CenterBook, private redeem: HvRedeem | null = null, private log: (m: string) => void = () => undefined) {}

  /**
   * 中心下单；本地订单号作 requestId → 同一本地单重试得到同一中心单号（中心按单号幂等）。
   * hvToken 在这里兑换一次（SDK redeemHumanToken，语义与 SDK withHuman 相同：bad = 不声明通过，交中心拒；
   * ok / 验证服务不可达 = 通过）。不交给 SDK 每次下单各兑一次，是因为凭证一次性：OPEN_ORDER 后自动「取消后重下」
   * 的第二次下单再兑就成 bad，玩家会卡在「验证 → 下单 → 再要验证」的死循环。未配 PAY_HV_HOST（redeem=null）= 忽略凭证。
 * 验证服务不可达的放行会记日志并计数（stats.hvUnavailable）。
   */
  async create(order: CenterLocalOrder, ctx: CenterPayContext, acceptReuse: AcceptReuse): Promise<CenterOrderLink> {
    const verdict = ctx.hvToken && this.redeem ? await this.redeem(ctx.hvToken) : null
    if (verdict === 'unavailable') {
      // 放行是有意的（验证服务挂了不能挡住收款），但不能没人知道：这段时间付款前的人机验证等于没开。
      this.stats.hvUnavailable++
      this.log(`[pay-center] 人机验证服务不可达，本次按通过放行（进程内累计 ${this.stats.hvUnavailable} 次）`)
    }
    return this.place(order, ctx, verdict === 'ok' || verdict === 'unavailable', 'ask', acceptReuse)
  }

  private async place(order: CenterLocalOrder, ctx: CenterPayContext, passed: boolean, onOpen: 'ask' | 'cancel', acceptReuse: AcceptReuse): Promise<CenterOrderLink> {
    const r: SiteCreateResult = await this.pay.createOrder({
      userId: order.userId, amountCents: order.amountCents, meta: { orderNo: order.orderNo }, requestId: order.orderNo, onOpen,
      ...(passed ? { challengePassed: true } : {}),
      ...(ctx.username ? { username: ctx.username } : {}), ...(ctx.nickname ? { nickname: ctx.nickname } : {}),
      ...(ctx.phone ? { phone: ctx.phone, phoneVerified: true } : {}), ...(ctx.clientIp ? { clientIp: ctx.clientIp } : {}),
      ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}), ...(ctx.deviceFingerprint ? { deviceFingerprint: ctx.deviceFingerprint } : {}),
      ...(ctx.accountCreatedAt ? { accountCreatedAt: ctx.accountCreatedAt } : {}),
    })
    if (!r.ok) {
      // 本站自己的另一笔未付单（换了套餐又点购买）= 玩家要的就是「取消后重新下单」。
      if (r.code === 'OPEN_ORDER' && r.open?.sameSite && onOpen === 'ask') return this.place(order, ctx, passed, 'cancel', acceptReuse)
      throw centerRefusal(r.code, r.message)
    }
    // 中心把玩家同金额的旧未付单还回来（reused）：那笔本地订单与这次是同人同套餐同金额才交回它；
    // 否则（同价的另一个套餐等）等同「取消后重新下单」——不能让玩家付着旧单的码、买的却是另一个套餐。
    const rec = await this.book.load(r.order.orderNo)
    const localOrderNo = (rec && localOrderNoOf(rec.meta)) ?? order.orderNo
    if (localOrderNo !== order.orderNo && !(await acceptReuse(localOrderNo))) {
      if (onOpen === 'cancel') throw centerRefusal('OPEN_ORDER', '你还有一笔未完成的其它订单，请先完成支付或等它过期后再购买')
      // 重下沿用同一个中心单号（按 requestId 推出来的），SDK 刚把它在订单簿里标成 reused：重下成功后再把标记拿掉
      //（先拿掉的话，重下失败会留下一条指向不存在中心单的活记录）。回调按单号查订单簿，不看这个标记，不受影响。
      const link = await this.place(order, ctx, passed, 'cancel', acceptReuse)
      await this.book.reopen(order.orderNo)
      return link
    }
    return { siteOrderNo: r.order.orderNo, payUrl: r.order.payUrl, checkoutUrl: safeHttps(r.order.checkoutUrl), expireAt: r.order.expireAt, localOrderNo }
  }

  /** 查单（带签名的服务端请求）：返回中心状态；本地订单没有中心单 = null。已付时带上对账补发用的付款事件。 */
  async state(localOrderNo: string): Promise<CenterOrderState> {
    const rec = await this.book.byLocalOrderNo(localOrderNo)
    if (!rec) return null
    const s = await this.pay.getOrder(rec.userId, rec.siteOrderNo)
    if (!s) return null
    const paidAt = new Date(s.paidAt ?? Date.now())
    const paid: PaidEvent | null = s.status !== 'paid' ? null : {
      mode: 'center', orderNo: rec.siteOrderNo, idempotencyKey: rec.siteOrderNo, userId: rec.userId, amountCents: rec.amountCents,
      paidCents: rec.amountCents, meta: rec.meta, late: false, paidAt: Number.isFinite(paidAt.getTime()) ? paidAt : new Date(),
    }
    return { status: s.status, siteOrderNo: rec.siteOrderNo, paid }
  }

  /** 原始请求体进、HTTP 回复出（2xx + {"code":0} 才算收到；其它中心会退避重试 72 小时）。 */
  notify(rawBody: string) { return this.pay.handleNotify('center', rawBody) }
}

const safeHttps = (url: string | null) => (url && url.startsWith('https://') ? url : null)

/** 回调里的 PaidEvent → fulfillPaidOrder 的入参（事件号 = 中心站点单号，与 zhongzhuan 的事件号不会撞）。 */
/** payment_events 里一笔中心订单的付款事件号（PaidEvent.idempotencyKey 就是站点单号）。退款关单占的也是它。 */
export const centerEventId = (siteOrderNo: string) => `center:${siteOrderNo}`
export function centerFulfilInput(providerCode: string, e: PaidEvent, localOrderNo: string) {
  return {
    providerCode, eventId: centerEventId(e.idempotencyKey), orderNo: localOrderNo, amountCents: e.amountCents, providerOrderNo: e.orderNo,
    payloadHash: createHash('sha256').update(JSON.stringify({ ...e, paidAt: e.paidAt.toISOString() })).digest('hex'), paidAt: e.paidAt,
  }
}

export type CenterEnv = SitePayEnv & Record<string, string | undefined>
type SiteClient = CenterSideOptions['client']

/** 组装 CenterPay（生产走 createCenterPayFromEnv；测试直接给 createMockCenter().client）。 */
export function createCenterPay(o: {
  appId: string; secret: string; client: SiteClient; db: Queryable; onPaid: CenterFulfil; onRefunded: CenterRefund;
  baseUrl?: string; hvHost?: string; hvUrl?: string; log?: (m: string) => void; hvRedeem?: HvRedeem;
}): CenterPay {
  const book = pgCenterOrderBook(o.db)
  const log = o.log ?? (m => console.warn(m))
  const pay = createSitePay({
    mode: 'center',
    center: {
      appId: o.appId, secret: o.secret, client: o.client, book, dedupe: pgCenterDedupe(o.db), orderPrefix: 'P', snapshotFile: null,
      ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}),
      // 中心侧退款（运营在支付中心后台退）：核对订单簿后交给本地退款路径；抛错 = 不确认，中心会重试。
      async onRefunded(n) {
        const rec = await book.load(n.site_order_no)
        if (!rec) throw new Error(`center refund: unknown site order ${n.site_order_no}`)
        if (rec.userId !== n.user_ref) throw new Error(`center refund: user mismatch on ${n.site_order_no}`)
        const localOrderNo = localOrderNoOf(rec.meta)
        if (!localOrderNo) throw new Error(`center refund ${n.site_order_no}: meta.orderNo missing`)
        await o.onRefunded({ siteOrderNo: rec.siteOrderNo, localOrderNo, refundedCents: Number(n.refunded_cents) || 0, amountCents: rec.amountCents, refundNo: n.refund_no ?? null })
      },
    },
    // 档位 / 金额上下限以中心「站点 → 充值档位」为准；中心不可达时只做最基本的金额校验。
    local: () => ({ minAmountCents: 1, allowCustom: true }),
    onLog: (m, err) => log(`[pay-center] ${m}${err ? ` ${String(err)}` : ''}`),
    async onPaid(e) {
      const localOrderNo = localOrderNoOf(e.meta)
      if (!localOrderNo) throw new Error(`center notify ${e.orderNo}: meta.orderNo missing`)
      await o.onPaid(e, localOrderNo)
    },
  })
  const hv = o.hvHost ? { host: o.hvHost, ...(o.hvUrl ? { url: o.hvUrl } : {}) } : null
  const redeem: HvRedeem | null = o.hvRedeem ?? (hv ? token => redeemHumanToken(hv, token, 'pay') : null)
  return new CenterPay(pay, book, redeem, log)
}

/**
 * 运行时 env 齐全（PAY_MODE=center + PAY_CENTER_URL / APP_ID / SECRET）才接中心，否则 null（center 通道下单报「未配置」）。
 * PAY_HV_HOST（可选）= 付款前人机验证绑定的站点域名。hooks 由 PaymentService 给（它负责发放 / 退款落地 + 到账通知）。
 */
export function createCenterPayFromEnv(env: CenterEnv, db: Queryable, hooks: CenterHooks, log: (m: string) => void = m => console.warn(m)): CenterPay | null {
  const { PAY_MODE, PAY_CENTER_URL: baseUrl, PAY_CENTER_APP_ID: appId, PAY_CENTER_SECRET: secret } = env
  if (PAY_MODE?.trim() !== 'center' || !baseUrl || !appId || !secret) return null
  return createCenterPay({
    appId, secret, baseUrl, db, ...hooks, log, client: createPayClient({ appId, secret, baseUrl }),
    ...(env.PAY_HV_HOST ? { hvHost: env.PAY_HV_HOST } : {}), ...(env.PAY_HV_URL ? { hvUrl: env.PAY_HV_URL } : {}),
  })
}
