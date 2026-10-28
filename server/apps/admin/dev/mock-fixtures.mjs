// 本地预览用的假数据（用户 / 设备 / 套餐 / 订单 / 兑换码 / 公告 / 版本 / 审计 / 用户详情）。
// 只给 dev/mock-api.mjs 用；确定性随机数，日期相对当前时间。
let seed = 20261029
export const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
export const pick = (arr) => arr[Math.floor(rand() * arr.length)]
export const int = (a, b) => a + Math.floor(rand() * (b - a + 1))
const NOW = Date.now()
export const ago = (ms) => new Date(NOW - ms).toISOString()
export const later = (ms) => new Date(NOW + ms).toISOString()
export const DAY = 86_400_000, HOUR = 3_600_000, MIN = 60_000
const uuid = (n, p = 'a') => `${p.repeat(8)}-0000-4000-8000-${String(n).padStart(12, '0')}`
export const UUID = uuid

const NAMES = ['zhangwei', 'lina', 'wangfang', 'liuyang', 'chenjie', 'yangmei', 'zhaolei', 'huangxin', 'zhoutao', 'wuhao', 'xujing', 'sunqiang', 'maxiao', 'zhuli', 'hulin', 'guopeng', 'heyun', 'gaofei', 'linzi', 'luobo']

export const plans = [
  { code: 'standard-month', name: '普通会员 · 月付', tier: 'standard', billingCycle: 'month', durationDays: 30, priceCents: 1800, originalPriceCents: null, maxDevices: 3, sortOrder: 10, badge: '' },
  { code: 'standard-quarter', name: '普通会员 · 季付', tier: 'standard', billingCycle: 'quarter', durationDays: 90, priceCents: 4800, originalPriceCents: 5400, maxDevices: 3, sortOrder: 20, badge: '省 11%' },
  { code: 'standard-year', name: '普通会员 · 年付', tier: 'standard', billingCycle: 'year', durationDays: 365, priceCents: 16800, originalPriceCents: 21600, maxDevices: 3, sortOrder: 30, badge: '推荐' },
  { code: 'premium-year', name: '超级会员 · 年付', tier: 'premium', billingCycle: 'year', durationDays: 365, priceCents: 29800, originalPriceCents: null, maxDevices: 8, sortOrder: 40, badge: '' },
  { code: 'premium-lifetime', name: '超级会员 · 永久', tier: 'premium', billingCycle: 'lifetime', durationDays: null, priceCents: 59800, originalPriceCents: null, maxDevices: 8, sortOrder: 50, badge: '限量' },
  { code: 'trial', name: '试用', tier: 'trial', billingCycle: 'trial', durationDays: 3, priceCents: 0, originalPriceCents: null, maxDevices: 1, sortOrder: 100, badge: '' },
].map((p, i) => ({
  id: uuid(i + 1, 'b'), description: `${p.name}，支持 ${p.maxDevices} 台设备同时在线`, lifetime: p.billingCycle === 'lifetime', currency: 'CNY',
  features: ['分应用代理', '规则分流', ...(p.tier === 'premium' ? ['专属线路', '优先客服'] : [])], active: p.code !== 'trial', public: p.code !== 'trial',
  saleStartsAt: null, saleEndsAt: null, purchaseLimitPerUser: null, createdAt: ago(200 * DAY), updatedAt: ago(int(1, 40) * DAY), ...p,
}))

export const users = Array.from({ length: 62 }, (_, i) => {
  const tier = i === 0 ? 'premium' : pick(['free', 'free', 'free', 'standard', 'standard', 'premium'])
  const plan = tier === 'free' ? null : plans.find((p) => p.tier === tier)
  const hasPhone = rand() > 0.35
  return {
    id: uuid(i + 1), username: i === 0 ? 'admin' : `${pick(NAMES)}${100 + i}`, email: rand() > 0.6 ? `user${i}@example.com` : null,
    phone: hasPhone ? `1${int(3, 9)}${int(0, 9)}****${String(int(0, 9999)).padStart(4, '0')}` : null,
    role: i === 0 ? 'admin' : 'user', status: i % 17 === 5 ? 'suspended' : i % 29 === 7 ? 'banned' : 'active', note: i % 9 === 0 ? '老客户，走过退款' : '',
    createdAt: ago(int(0, 120) * DAY + int(0, 23) * HOUR), expiresAt: plan ? (plan.lifetime ? null : later(int(-5, 300) * DAY)) : null, lifetime: plan?.lifetime ?? false,
    planName: plan?.name ?? null, tier: plan ? tier : null, devices: int(0, plan ? plan.maxDevices : 1), hasPassword: i % 11 !== 3,
    identities: i % 11 === 3 ? ['powervpn'] : [], channel: i % 13 === 4 ? 'aigw' : 'direct',
    fxTier: i % 10 === 1 ? 'agent' : null, fxEnabled: true, inviter: i > 3 && i % 4 === 0 ? 'zhangwei101' : null, fxDirect: i % 10 === 1 ? int(1, 12) : 0,
  }
})

export const devices = users.flatMap((u, ui) => Array.from({ length: u.devices }, (_, k) => {
  const plat = pick(['windows', 'windows', 'macos', 'android', 'ios', 'linux'])
  return {
    id: uuid(ui * 10 + k + 1, 'c'), userId: u.id, username: u.username, name: `${u.username} 的 ${plat === 'windows' ? '台式机' : plat === 'macos' ? 'MacBook' : '手机'}`,
    platform: plat, appVersion: pick(['1.10.12', '1.10.11', '1.10.5', '1.9.8']), revoked: rand() > 0.9,
    firstSeenAt: ago(int(5, 100) * DAY), lastSeenAt: ago(rand() > 0.5 ? int(1, 10) * MIN : int(1, 200) * HOUR),
  }
}))

const ORDER_STATUSES = ['paid', 'paid', 'paid', 'pending', 'closed', 'failed', 'refunded']
export const orders = Array.from({ length: 140 }, (_, i) => {
  const u = users[int(1, users.length - 1)], p = plans[int(0, 4)], status = pick(ORDER_STATUSES)
  const created = int(0, 60) * DAY + int(0, 23) * HOUR
  return {
    id: uuid(i + 1, 'd'), orderNo: `PS${20261029000 - i * 37}`, userId: u.id, username: u.username, planName: p.name, tier: p.tier, billingCycle: p.billingCycle,
    amountCents: p.priceCents, currency: 'CNY', status, providerCode: i % 15 === 0 ? 'manual' : 'shouqianba', providerOrderNo: status === 'pending' ? null : `SQB${900000 + i}`,
    paidAt: status === 'paid' || status === 'refunded' ? ago(created - 3 * MIN) : null, createdAt: ago(created),
    ...(i % 6 === 0 ? { commissionCents: Math.round(p.priceCents * 0.2) } : {}),
  }
})
// 一组拆单：同一 groupId 的两张子单，佣金按整单记。
orders[1] = { ...orders[1], groupId: 'G-20261028-01', status: 'paid', paidAt: ago(2 * DAY), commissionCents: 5960 }
orders[2] = { ...orders[2], groupId: 'G-20261028-01', status: 'paid', paidAt: ago(2 * DAY), commissionCents: 5960 }

export const redeemCodes = Array.from({ length: 48 }, (_, i) => {
  const p = plans[int(0, 4)], status = pick(['active', 'active', 'used', 'disabled']), multi = i % 8 === 0
  return {
    id: uuid(i + 1, 'e'), code: `PS-${Math.floor(rand() * 1e8).toString(36).toUpperCase().padStart(6, 'X')}-${int(1000, 9999)}`, status,
    durationDays: p.durationDays, lifetime: p.lifetime, note: i % 5 === 0 ? '双十一活动' : '', batchId: uuid(Math.floor(i / 10) + 1, 'f'),
    codeExpiresAt: i % 7 === 0 ? ago(3 * DAY) : later(int(10, 90) * DAY), redeemedAt: status === 'used' ? ago(int(1, 30) * DAY) : null,
    createdAt: ago(int(30, 60) * DAY), planName: p.name, tier: p.tier, redeemedBy: status === 'used' ? pick(users).username : null,
    maxUses: multi ? 50 : 1, usedCount: status === 'used' ? 1 : multi ? int(0, 50) : 0,
  }
})

export const announcements = [
  { type: 'release', title: 'v1.10.12 已发布：订阅导入更稳', summary: '修复部分订阅导入失败', version: '1.10.12', pinned: true },
  { type: 'maintenance', title: '10 月 31 日凌晨支付通道维护', summary: '02:00–03:00 暂停下单', version: '', pinned: false },
  { type: 'notice', title: '免费版上线：所有功能可用，限 1 台设备', summary: '会员设备数在免费名额上叠加', version: '', pinned: false },
  { type: 'notice', title: '注册改为手机号验证', summary: '老用户登录后可补绑手机号', version: '', pinned: false },
].map((a, i) => ({ id: uuid(i + 1, '1'), content: `${a.summary}。\n\n详细说明……`, active: i !== 3, publishedAt: ago(i * 3 * DAY), startsAt: null, endsAt: i === 1 ? later(2 * DAY) : null, createdAt: ago(i * 3 * DAY), updatedAt: ago(i * 3 * DAY), ...a }))

export const releases = ['1.10.12', '1.10.11', '1.10.5', '1.9.8'].map((v, i) => ({
  id: uuid(i + 1, '2'), version: v, minimumVersion: '1.9.0', url: `https://dl.example.com/ProxySplit-${v}-setup.exe`, sha256: 'ab'.repeat(32),
  signature: 'MEUCIQ' + 'x'.repeat(60), mandatory: true, title: `ProxySplit ${v}`, summary: '稳定性改进', changelog: '- 修复若干问题\n- 优化启动速度', channel: i === 1 ? 'beta' : 'stable', publishedAt: ago(i * 6 * DAY),
}))

const ACTIONS = ['auth.login', 'admin.user.status', 'admin.license.grant', 'admin.order.refund', 'admin.plan.update', 'admin.redeem.create', 'user.redeem', 'user.phone.bind', 'admin.settings.commerce']
export const audit = Array.from({ length: 120 }, (_, i) => {
  const action = pick(ACTIONS), actor = pick(users)
  return {
    id: uuid(i + 1, '3'), action, targetType: action.includes('order') ? 'order' : action.includes('plan') ? 'plan' : action.includes('redeem') ? 'redeem-code' : action.includes('settings') ? 'settings' : 'user',
    targetId: pick(users).id, ip: `10.0.${int(0, 255)}.${int(1, 254)}`, result: i % 13 === 0 ? 'denied' : 'success', metadata: { reason: action.includes('refund') ? '用户重复下单' : undefined, days: 30 },
    createdAt: ago(i * 47 * MIN), actor: i % 9 === 0 ? null : actor.username,
  }
})

export function userDetail(u) {
  const myOrders = orders.filter((o) => o.userId === u.id)
  const paid = myOrders.filter((o) => o.status === 'paid')
  return {
    user: { id: u.id, username: u.username, email: u.email, phone: u.phone, role: u.role, status: u.status, note: u.note, createdAt: u.createdAt, updatedAt: u.createdAt, trialStartedAt: null, trialEndsAt: null },
    stats: { activeDevices: devices.filter((d) => d.userId === u.id && !d.revoked).length, paidOrders: paid.length, paidAmountCents: paid.reduce((s, o) => s + o.amountCents, 0) },
    fenxiao: u.fxTier || u.inviter ? { tierCode: u.fxTier, enabled: true, code: 'ZW8K2P', inviter: u.inviter, boundAt: ago(20 * DAY), direct: u.fxDirect, team: u.fxDirect * 2, paidOrders: 4, earnedCents: 23800, availableCents: 12000, frozenCents: 3600, withdrawnCents: 8200 } : null,
    licenses: u.planName ? [{ id: uuid(1, '4'), status: 'active', startsAt: ago(30 * DAY), expiresAt: u.expiresAt ?? later(9000 * DAY), createdAt: ago(30 * DAY), source: 'order', lifetime: u.lifetime, planCode: 'standard-year', planName: u.planName, tier: u.tier, maxDevices: 3, features: ['分应用代理'] }] : [],
    devices: devices.filter((d) => d.userId === u.id).map((d) => ({ ...d, activeSessions: d.revoked ? 0 : int(0, 2) })),
    orders: myOrders.map((o) => ({ ...o, durationDays: 30, lifetime: false, expiresAt: later(30 * DAY) })),
    activity: audit.slice(0, 8).map((a) => ({ ...a, targetId: u.id })),
  }
}
