// 运营后台本地预览用的假 API（零依赖）。数据全是假的，只用来看页面和截图，不连任何数据库。
// 用法（在 server/apps/admin 下）：
//   node dev/mock-api.mjs 18799
//   VITE_API_URL=http://127.0.0.1:18799 pnpm dev      （PowerShell：$env:VITE_API_URL='http://127.0.0.1:18799'; pnpm dev）
// 登录任意用户名 / 密码都行；或在浏览器 sessionStorage 里放 ps-admin-token=mock。
import http from 'node:http'
import * as F from './mock-fixtures.mjs'
import * as O from './mock-fixtures-ops.mjs'

const port = Number(process.argv[2] || 18799)

/** 粗略的列表过滤 + 分页：q 匹配任意字符串字段，其它查询参数按字段等值匹配（布尔按字符串比）。 */
function list(rows, qs, extra = {}) {
  const q = (qs.get('q') || '').toLowerCase()
  const skip = new Set(['q', 'limit', 'offset', 'page', 'pageSize', 'sort', 'order', 'createdFrom', 'createdTo', 'from', 'to', 'days'])
  let out = rows.filter((r) => !q || Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))
  for (const [k, v] of qs) {
    if (skip.has(k) || v === '') continue
    if (k === 'online') { out = out.filter((r) => (Date.now() - new Date(r.lastSeenAt).getTime() < 15 * F.MIN) === (v === 'true')); continue }
    out = out.filter((r) => !(k in r) || String(r[k]) === v)
  }
  const sort = qs.get('sort')
  if (sort) {
    const dir = qs.get('order') === 'asc' ? 1 : -1
    out = [...out].sort((a, b) => (a[sort] > b[sort] ? dir : a[sort] < b[sort] ? -dir : 0))
  }
  const pageSize = Number(qs.get('pageSize') || qs.get('limit') || 20)
  const offset = qs.has('page') ? (Number(qs.get('page')) - 1) * pageSize : Number(qs.get('offset') || 0)
  return { items: out.slice(offset, offset + pageSize), total: out.length, limit: pageSize, offset, ...extra }
}

const days = (qs, d = 30) => Number(qs.get('days') || d)
const userById = (id) => F.users.find((u) => u.id === id)

/** [method, 正则, 处理函数(match, qs, body)] —— 先写具体的，再写通配的。 */
const routes = [
  ['POST', /^\/v1\/auth\/login$/, () => ({ accessToken: 'mock', refreshToken: 'mock', deviceLimitReached: false })],
  ['GET', /^\/v1\/admin\/dashboard$/, () => O.dashboard],
  ['GET', /^\/v1\/admin\/analytics$/, (m, qs) => O.analytics(days(qs))],
  ['GET', /^\/v1\/admin\/stats\/overview$/, (m, qs) => O.statsOverview(days(qs))],
  ['GET', /^\/v1\/admin\/downloads$/, (m, qs) => O.downloads(days(qs))],
  ['GET', /^\/v1\/admin\/users$/, (m, qs) => list(F.users, qs)],
  ['GET', /^\/v1\/admin\/users\/([^/]+)\/cloud$/, (m) => O.userCloud(m[1])],
  ['GET', /^\/v1\/admin\/users\/([^/]+)$/, (m) => { const u = userById(m[1]); return u ? F.userDetail(u) : [404, { error: { code: 'NOT_FOUND', message: '用户不存在' } }] }],
  ['POST', /^\/v1\/admin\/users$/, (m, qs, b) => ({ id: F.UUID(999), username: b.username })],
  ['POST', /^\/v1\/admin\/users\/[^/]+\/grant$/, () => ({ ok: true, expiresAt: F.later(30 * F.DAY), lifetime: false })],
  ['POST', /^\/v1\/admin\/users\/[^/]+\/extend$/, () => ({ expiresAt: F.later(60 * F.DAY) })],
  ['GET', /^\/v1\/admin\/devices$/, (m, qs) => list(F.devices, qs)],
  ['GET', /^\/v1\/admin\/plans$/, (m, qs) => list(F.plans, qs)],
  ['POST', /^\/v1\/admin\/plans$/, (m, qs, b) => ({ id: F.UUID(998, 'b'), ...b })],
  ['GET', /^\/v1\/admin\/orders$/, (m, qs) => list(F.orders, qs, { amountSum: F.orders.filter((o) => o.status === 'paid').reduce((s, o) => s + o.amountCents, 0) })],
  ['POST', /^\/v1\/admin\/orders\/[^/]+\/refund$/, () => ({ ok: true, orders: 2, licenseAdjusted: true, removedDays: 30 })],
  ['POST', /^\/v1\/admin\/orders\/[^/]+\/confirm$/, () => ({ ok: true, duplicate: false })],
  ['GET', /^\/v1\/admin\/redeem-codes$/, (m, qs) => list(F.redeemCodes, qs)],
  ['POST', /^\/v1\/admin\/redeem-codes$/, (m, qs, b) => ({ batchId: F.UUID(77, 'f'), codes: Array.from({ length: Math.min(Number(b.count) || 1, 20) }, (_, i) => `PS-MOCK${i}-${1000 + i}`) })],
  ['POST', /^\/v1\/admin\/redeem-codes\/[^/]+\/status$/, (m, qs, b) => ({ ok: true, status: b.status })],
  ['GET', /^\/v1\/admin\/announcements$/, (m, qs) => list(F.announcements, qs)],
  ['GET', /^\/v1\/admin\/releases$/, (m, qs) => list(F.releases, qs)],
  ['GET', /^\/v1\/admin\/audit$/, (m, qs) => list(F.audit, qs)],
  ['GET', /^\/v1\/admin\/settings\/commerce$/, () => O.commerce],
  ['PATCH', /^\/v1\/admin\/settings\/commerce$/, (m, qs, b) => Object.assign(O.commerce, b)],
  ['GET', /^\/v1\/admin\/payment-providers$/, () => ({ items: O.providers })],
  ['POST', /^\/v1\/admin\/payment-providers\/([^/]+)\/activate$/, (m) => Object.assign(O.commerce, { activePaymentProvider: decodeURIComponent(m[1]) })],
  ['GET', /^\/v1\/admin\/telemetry\/devices$/, (m, qs) => list(O.telemetryDevices, qs)],
  ['GET', /^\/v1\/admin\/telemetry\/devices\/([^/]+)\/events$/, (m, qs) => list(O.telemetryEvents, qs)],
  ['GET', /^\/v1\/admin\/telemetry\/devices\/([^/]+)\/logs$/, (m, qs) => list(O.telemetryLogs, qs)],
  ['GET', /^\/v1\/admin\/telemetry\/devices\/([^/]+)$/, (m) => { const d = O.telemetryDevices.find((x) => x.deviceId === m[1]) ?? O.telemetryDevices[0]; return { ...d, app_version: d.appVersion } }],
  ['GET', /^\/v1\/admin\/telemetry\/failures$/, (m, qs) => list(O.failures, qs)],
  ['GET', /^\/v1\/admin\/telemetry\/analytics$/, () => O.telemetryAnalytics],
  ['GET', /^\/v1\/admin\/client-nodes\/stats$/, () => O.nodeStats],
  ['GET', /^\/v1\/admin\/client-nodes\/changes$/, () => ({ items: O.nodeChanges })],
  ['GET', /^\/v1\/admin\/client-nodes$/, (m, qs) => list(O.clientNodes, qs)],
  ['GET', /^\/v1\/admin\/client-subs$/, (m, qs) => list(O.clientSubs, qs)],
  ['POST', /^\/v1\/admin\/client-nodes\/reveal$/, () => ({ link: 'vless://00000000-0000-4000-8000-000000000000@hk1.example.net:443?security=reality#HK-01' })],
  ['POST', /^\/v1\/admin\/client-subs\/reveal$/, () => ({ url: 'https://sub0.example.org/api/v1/client/subscribe?token=MOCK' })],
  ['GET', /^\/v1\/admin\/fenxiao\/policy$/, () => O.fxPolicy],
  ['PUT', /^\/v1\/admin\/fenxiao\/policy$/, (m, qs, b) => Object.assign(O.fxPolicy, b)],
  ['GET', /^\/v1\/admin\/fenxiao\/overview$/, () => O.fxOverview],
  ['GET', /^\/v1\/admin\/fenxiao\/members$/, (m, qs) => list(O.fxMembers, qs)],
  ['GET', /^\/v1\/admin\/fenxiao\/commissions$/, (m, qs) => list(O.fxCommissions, qs, { amountSumCents: O.fxCommissions.reduce((s, c) => s + c.amountCents, 0) })],
  ['GET', /^\/v1\/admin\/fenxiao\/withdrawals$/, (m, qs) => list(O.fxWithdrawals, qs)],
  // 其余写操作一律成功。
  ['POST', /^\/v1\/admin\//, (m, qs, b) => ({ ok: true, ...b })],
  ['PUT', /^\/v1\/admin\//, (m, qs, b) => ({ ok: true, ...b })],
  ['PATCH', /^\/v1\/admin\//, (m, qs, b) => ({ ok: true, ...b })],
  ['DELETE', /^\/v1\/admin\//, () => ({ ok: true })],
]

const server = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'authorization, content-type')
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const url = new URL(req.url, 'http://x')
    let body = {}
    try { body = raw ? JSON.parse(raw) : {} } catch { /* 非 JSON 正文按空处理 */ }
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)) }
    for (const [method, re, fn] of routes) {
      const m = method === req.method && re.exec(url.pathname)
      if (!m) continue
      const out = fn(m, url.searchParams, body)
      if (Array.isArray(out) && typeof out[0] === 'number') return send(out[0], out[1])
      return setTimeout(() => send(200, out), 120)
    }
    send(404, { error: { code: 'NOT_FOUND', message: `mock 没有 ${req.method} ${url.pathname}` } })
  })
})
server.listen(port, '127.0.0.1', () => console.log(`mock api on http://127.0.0.1:${port}`))
