// 本地预览假数据（二）：看板聚合、下载统计、客户端日志、同事节点、分销、支付通道、商业设置、云端配置。
import { DAY, HOUR, MIN, UUID, ago, int, later, orders, pick, rand, users } from './mock-fixtures.mjs'

const dayStr = (i) => new Date(Date.now() - i * DAY + 8 * HOUR).toISOString().slice(0, 10)
const series = (n, f) => Array.from({ length: n }, (_, k) => f(n - 1 - k, dayStr(n - 1 - k)))

export const dashboard = { users: users.length, licenses: 31, online: 18, expiring: 4, pendingOrders: 6, monthRevenue: 386400 }

export function analytics(days) {
  return {
    revenueDaily: series(days, (_, date) => ({ date, amountCents: int(0, 9) * 1800 + int(0, 3) * 29800, orders: int(0, 9) })),
    signupsDaily: series(days, (_, date) => ({ date, count: int(2, 30) })),
    ordersDaily: series(days, (_, date) => { const c = int(3, 20); return { date, created: c, paid: int(1, c) } }),
    orderStatus: ['paid', 'pending', 'closed', 'refunded', 'failed'].map((status) => ({ status, count: int(2, 80), amountCents: int(10, 900) * 100 })),
    membershipTier: [{ tier: 'standard', count: 22 }, { tier: 'premium', count: 9 }, { tier: 'trial', count: 3 }],
    newDevicesDaily: series(days, (_, date) => ({ date, count: int(1, 20) })),
    platformDist: [{ platform: 'windows', count: 61 }, { platform: 'android', count: 22 }, { platform: 'macos', count: 14 }, { platform: 'ios', count: 9 }],
    redeemStatus: [{ status: 'active', count: 30 }, { status: 'used', count: 12 }, { status: 'disabled', count: 6 }],
    auditDaily: series(days, (_, date) => ({ date, count: int(10, 90) })),
  }
}

export function statsOverview(days) {
  const now = new Date()
  const from = new Date(now.getTime() - days * DAY), prevFrom = new Date(from.getTime() - days * DAY)
  return {
    asOf: now.toISOString(), days, timeZone: 'Asia/Shanghai', window: { from: from.toISOString(), to: now.toISOString(), prevFrom: prevFrom.toISOString() },
    members: { users: 1284, paid: 312, free: 972, newPaid: { cur: days * 2 + 7, prev: days * 2 } },
    signups: { cur: days * 14, prev: days * 12, daily: series(days, (i, date) => ({ date, value: i === 3 ? 0 : int(5, 25) })) },
    revenue: { curCents: String(days * 51234), prevCents: String(days * 48800), paidOrders: { cur: days * 3, prev: days * 3 - 4 }, daily: series(days, (_, date) => ({ date, value: String(int(0, 12) * 1800 + int(0, 2) * 29800) })) },
    conversion: { cur: { cohort: days * 14, converted: days + 3 }, prev: { cohort: days * 12, converted: days } },
    phone: { bound: 801, total: 1284 },
    cloud: { profiles: 268, shared: 41, locked: 19, profileUsers: 190, syncUsers: 233 },
    sms: { sent24h: 87, prev24h: 74, verified24h: 69, byPurpose: [{ purpose: 'bind', count: 23 }, { purpose: 'register', count: 51 }, { purpose: 'reset', count: 13 }] },
    online: { devices15m: 143 },
  }
}

export function downloads(days) {
  return {
    summary: { downloads: 4120, downloadUniqueIps: 2310, downloadUniqueVisitors: 2190, views: 18800, viewUniqueIps: 9020, viewUniqueVisitors: 8800 },
    daily: series(days, (_, date) => { const d = int(40, 200); return { date, downloads: d, views: d * int(3, 6), downloadIps: Math.round(d * 0.6) } }),
    versions: ['1.10.12', '1.10.11', '1.10.5', '1.9.8'].map((version, i) => ({ version, total: 1800 - i * 400, uniqueIps: 1100 - i * 250 })),
    referers: [{ source: '直接访问', total: 2100 }, { source: 'baidu.com', total: 900 }, { source: 'google.com', total: 640 }, { source: 'github.com', total: 300 }, { source: '其他', total: 180 }],
    recent: Array.from({ length: 20 }, (_, i) => ({ kind: i % 3 ? 'view' : 'download', file: i % 3 ? '' : 'ProxySplit-1.10.12-setup.exe', version: '1.10.12', referer: pick(['', 'https://www.baidu.com/', 'https://github.com/']), createdAt: ago(i * 7 * MIN) })),
  }
}

const EVENTS = ['app_start', 'core_start', 'node_test', 'sub_update', 'proxy_error', 'update_check', 'crash', 'capture']
export const telemetryDevices = Array.from({ length: 45 }, (_, i) => {
  const u = rand() > 0.3 ? pick(users) : null
  return {
    deviceId: `dev-${(1e9 + i * 7919).toString(16)}`, firstSeen: ago(int(5, 60) * DAY), lastSeen: ago(int(1, 300) * MIN), appVersion: pick(['1.10.12', '1.10.11', '1.10.5']), coreVersion: 'xray 25.10.1',
    os: pick(['Windows 11 23H2', 'Windows 10 22H2', 'macOS 15.1']), arch: 'amd64', accountId: u?.id ?? null, username: u?.username ?? null, accountHint: u ? null : rand() > 0.5 ? 'li***' : null,
    lastIp: `111.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`, lastStatus: pick(['ok', 'ok', 'fail', 'info']), lastErrorCode: rand() > 0.7 ? 'CORE_EXIT' : null,
    lastStartAt: ago(int(1, 48) * HOUR), eventsCount: int(10, 900), logBytes: int(2000, 900000),
  }
})
export const failures = EVENTS.slice(0, 6).map((type, i) => ({ type, errorCode: ['CORE_EXIT', 'TLS_HANDSHAKE', 'SUB_FETCH_403', 'PORT_IN_USE', 'DNS_TIMEOUT', 'WINTUN_LOAD'][i], count: int(5, 300), devices: int(2, 60), lastAt: ago(int(1, 600) * MIN), sampleText: 'process exited with code 1: listen tcp 127.0.0.1:10808: bind: address already in use', sampleDevice: telemetryDevices[i].deviceId, versions: ['1.10.12', '1.10.11'] }))
const kv = (keys) => keys.map((key) => { const s = int(20, 400), ok = int(Math.round(s * 0.7), s); return { key, starts: s, ok, okRate: ok / s } })
export const telemetryAnalytics = {
  daily: series(7, (_, day) => { const s = int(200, 600); return { day, activeDevices: int(80, 300), starts: s, startOk: Math.round(s * 0.93), failures: int(5, 40) } }),
  startByVersion: kv(['1.10.12', '1.10.11', '1.10.5']), startByOs: kv(['Windows 11', 'Windows 10', 'macOS']), startByCapture: kv(['tun', 'system-proxy', 'process']), startByProtocol: kv(['vless', 'hysteria2', 'trojan', 'shadowsocks']),
  topErrors: failures.map((f) => ({ key: f.errorCode, count: f.count, devices: f.devices })),
  security: [{ key: '360 安全卫士', devices: 41 }, { key: '火绒', devices: 33 }, { key: 'Windows Defender', devices: 120 }],
  topApps: [{ key: 'chrome.exe', devices: 210 }, { key: 'Code.exe', devices: 98 }, { key: 'WeChat.exe', devices: 77 }],
  latencyByProtocol: ['vless', 'hysteria2', 'trojan'].map((key) => { const t = int(100, 900), f = int(3, 60); return { key, tests: t, failed: f, failRate: f / t } }),
}
export const telemetryEvents = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, eventId: `ev-${i}`, sessionId: `s-${Math.floor(i / 10)}`, seq: i % 10, ts: ago(i * 13 * MIN), type: pick(EVENTS), status: pick(['ok', 'ok', 'fail', 'info']), durationMs: int(5, 4000), errorCode: i % 7 === 0 ? 'CORE_EXIT' : null, errorText: i % 7 === 0 ? 'core exited unexpectedly' : null, appVersion: '1.10.12', payload: { node: 'HK-01', protocol: 'vless', latencyMs: int(40, 300) } }))
export const telemetryLogs = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, sessionId: `s-${i}`, startedAt: ago((i + 1) * 5 * HOUR), endedAt: ago((i + 1) * 5 * HOUR - 40 * MIN), lineCount: int(50, 900), bytes: int(4000, 90000), text: '[info] core started\n[info] listening 127.0.0.1:10808\n[warn] node HK-02 timeout\n[info] switched to HK-01' }))

const TYPES = ['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'tuic']
export const clientNodes = Array.from({ length: 70 }, (_, i) => {
  const u = pick(users), lat = rand() > 0.85 ? -1 : rand() > 0.9 ? 0 : int(30, 400)
  return {
    deviceId: telemetryDevices[i % telemetryDevices.length].deviceId, nodeId: `n-${i}`, accountId: u.id, username: u.username, accountHint: null, name: `${pick(['香港', '日本', '新加坡', '美国'])} ${String(i % 12 + 1).padStart(2, '0')}`,
    type: pick(TYPES), server: `${pick(['hk', 'jp', 'sg', 'us'])}${i % 9}.example.net`, port: pick([443, 8443, 2053]), network: pick(['tcp', 'ws', 'grpc']), security: pick(['reality', 'tls', 'none']), sni: 'www.microsoft.com',
    core: pick(['xray', 'sing-box']), via: i % 11 === 0 ? 'relay-1' : null, subId: i % 3 ? `sub-${i % 5}` : null, official: i % 9 === 0, source: i % 9 === 0 ? 'official' : i % 3 ? 'sub' : 'manual',
    latency: lat, tcpLatency: lat > 0 ? lat - 10 : lat, speed: lat > 0 ? int(1, 80) * 1e6 : null, hasLink: i % 9 !== 0, selected: i % 8 === 0, firstSeen: ago(int(3, 40) * DAY), lastSeen: ago(int(1, 300) * MIN), removedAt: i % 19 === 0 ? ago(2 * DAY) : null,
  }
})
export const clientSubs = Array.from({ length: 18 }, (_, i) => ({ deviceId: telemetryDevices[i].deviceId, subId: `sub-${i}`, username: pick(users).username, name: `机场 ${i + 1}`, host: `sub${i}.example.org`, hasUrl: true, nodeCount: int(5, 80), autoUpdate: i % 3 !== 0, lastUpdate: ago(int(1, 48) * HOUR), lastSeen: ago(int(1, 300) * MIN), removedAt: null }))
export const nodeChanges = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, deviceId: telemetryDevices[i % 10].deviceId, username: pick(users).username, kind: i % 4 ? 'node' : 'sub', name: `香港 ${(i % 12) + 1}`, action: pick(['add', 'remove', 'update']), fields: ['port', 'sni'].slice(0, int(0, 2)), at: ago(i * 37 * MIN) }))
export const nodeStats = {
  devices: 120, nodes: clientNodes.length, subs: clientSubs.length, dead: 9, deadRate: 9 / clientNodes.length, changes24h: 23, canReveal: true,
  byType: TYPES.map((key) => ({ key, nodes: int(3, 30), devices: int(2, 20), dead: int(0, 3) })), byServer: [{ key: 'hk1.example.net', nodes: 12, devices: 5 }, { key: 'jp2.example.net', nodes: 8, devices: 1 }, { key: 'sg0.example.net', nodes: 6, devices: 3 }],
}

export const fxPolicy = {
  enabled: true, mode: 'differential', maxLevels: 2, openToAll: true, defaultRates: [1000, 500], tiers: [{ code: 'agent', name: '代理', rates: [2000, 800] }, { code: 'partner', name: '合伙人', rates: [3000, 1000] }],
  totalCapBps: 4000, freezeDays: 7, minBaseCents: 100, minWithdrawalCents: 5000, holdAboveCents: 50000, planRules: [], recurringMaxOrders: 0, recurringWithinDays: 0, withdrawalFeeBps: 100, withdrawalFeeFixedCents: 0,
}
export const fxOverview = { periodCommissionCents: 238900, periodCount: 64, frozenCents: 42100, heldCommissions: 3, heldCents: 18800, availableCents: 99000, withdrawingCents: 30000, pendingWithdrawals: 2, withdrawnCents: 410000, boundMembers: 318, agents: 12, reversedCents: 5960 }
const acct = () => ({ frozenCents: int(0, 9) * 100, heldCents: 0, availableCents: int(-1, 90) * 100, withdrawingCents: 0, withdrawnCents: int(0, 90) * 1000, earnedCents: int(10, 300) * 100, reversedCents: int(0, 2) * 100 })
export const fxMembers = users.slice(1, 25).map((u, i) => ({ userId: u.id, username: u.username, parentUserId: i > 4 ? users[2].id : null, parentUsername: i > 4 ? users[2].username : null, code: `C${(1e5 + i * 77).toString(36).toUpperCase()}`, tierCode: i < 5 ? 'agent' : null, tierName: i < 5 ? '代理' : null, enabled: i !== 3, rateOverride: i === 1 ? [2500, 1000] : null, note: '', boundAt: ago(int(1, 90) * DAY), directCount: int(0, 12), teamCount: int(0, 30), account: acct() }))
export const fxCommissions = orders.slice(0, 40).map((o, i) => ({ id: UUID(i + 1, '5'), sourceKind: i === 7 ? 'adjust' : 'order', sourceRef: o.orderNo, orderNo: o.orderNo, planName: o.planName, buyer: o.username, beneficiary: fxMembers[i % 5].username, level: (i % 2) + 1, baseCents: o.amountCents, rateBps: i % 2 ? 800 : 2000, amountCents: Math.round(o.amountCents * (i % 2 ? 0.08 : 0.2)), status: i < 3 ? 'held' : pick(['frozen', 'available', 'available', 'reversed']), availableAt: later(int(1, 7) * DAY), holdReason: i < 3 ? '单笔超过 500 元，待人工放行' : null, note: i === 7 ? '活动补发' : null, reverseReason: '订单退款', createdAt: ago(i * 9 * HOUR) }))
export const fxWithdrawals = Array.from({ length: 12 }, (_, i) => ({ id: UUID(i + 1, '6'), username: fxMembers[i % 6].username, amountCents: int(50, 900) * 100, feeCents: 100, netCents: 0, status: i < 2 ? 'pending' : pick(['paid', 'rejected']), payee: { method: pick(['alipay', 'wechat', 'bank']), account: '138****5678', name: '张*' }, adminNote: '', createdAt: ago(i * DAY), reviewedAt: i < 2 ? null : ago(i * DAY - HOUR) })).map((w) => ({ ...w, netCents: w.amountCents - w.feeCents }))

export const providers = [
  { code: 'shouqianba', displayName: '收钱吧（支付宝）', adapter: 'zhongzhuan', endpoint: 'https://pay.example.com/api', merchantId: 'M1002233', credentialRef: 'SHOUQIANBA', config: { orderTimeoutMinutes: 10 }, enabled: true, updatedAt: ago(5 * DAY) },
  { code: 'manual', displayName: '人工确认', adapter: 'manual', endpoint: '', merchantId: '', credentialRef: 'MANUAL_PAY', config: { orderTimeoutMinutes: 30 }, enabled: false, updatedAt: ago(40 * DAY) },
]
export const commerce = { registrationEnabled: true, trialDays: 0, trialPlanCode: 'trial', maxAccountsPerDevice: 3, maxAccountsPerIp: 10, defaultDeviceLimit: 1, licenseLeaseMinutes: 60, offlineGraceHours: 24, activePaymentProvider: 'shouqianba', paymentMethods: ['alipay'] }

export const userCloud = (id) => (id.endsWith('1') || id.endsWith('3')
  ? { sync: { version: 17, size: 48211, deviceName: '公司台式机', updatedAt: ago(3 * HOUR) }, profiles: [
      { id: UUID(1, '7'), name: '公司电脑', size: 40211, deviceName: '公司台式机', shared: true, locked: false, createdAt: ago(20 * DAY), updatedAt: ago(2 * DAY) },
      { id: UUID(2, '7'), name: '家里', size: 31877, deviceName: 'MacBook', shared: false, locked: true, createdAt: ago(9 * DAY), updatedAt: ago(9 * DAY) },
    ] }
  : { sync: null, profiles: [] })
