// 分销的接口层：给 API 用。包只认用户 id，这里负责查用户名、订单号，把 bigint 换成 number（人民币分），
// 推广人看到的下级 / 买家用户名打码（隐私边界在宿主）。后台动作都带 operatorId，包里同事务写 fx_audit。
import { AppError } from '@proxysplit/shared'
import type { FenxiaoCommissionsQuery, FenxiaoMemberPatch, FenxiaoMembersQuery, FenxiaoPolicyInput, FenxiaoWithdrawalsQuery } from '@proxysplit/contracts'
import { FENXIAO_POLICY_KEY, readFenxiaoPolicy, toFxPolicy } from './fenxiao.js'
import { assertFxPolicy, FenxiaoError, type FxAccount, type FxCommission, type FxMember, type FxWithdrawal } from './vendor/fenxiao/index.js'
import { HTTP_STATUS_BY_CODE } from './vendor/fenxiao/http/index.js'
import type { PgStore } from './store.js'

const n = (v: bigint) => Number(v)
export const maskName = (s: string) => (s.length <= 2 ? `${s.slice(0, 1)}*` : `${s.slice(0, 2)}***${s.length > 5 ? s.slice(-1) : ''}`)

const accountView = (a: FxAccount) => ({
  frozenCents: n(a.frozen), heldCents: n(a.held), availableCents: n(a.available), withdrawingCents: n(a.withdrawing),
  withdrawnCents: n(a.withdrawn), earnedCents: n(a.earned), reversedCents: n(a.reversed),
})
const commissionView = (c: FxCommission) => ({
  id: String(c.id), sourceKind: c.sourceKind, sourceRef: c.sourceRef, buyerUserId: c.buyerUserId, beneficiaryUserId: c.beneficiaryUserId,
  level: c.level, baseCents: n(c.baseAmount), rateBps: c.rateBps, amountCents: n(c.amount), status: c.status,
  availableAt: c.availableAt, holdReason: c.holdReason, note: c.note, reversedAt: c.reversedAt, reverseReason: c.reverseReason, createdAt: c.createdAt,
})
const withdrawalView = (w: FxWithdrawal) => ({
  id: String(w.id), userId: w.userId, amountCents: n(w.amount), feeCents: n(w.fee), netCents: n(w.net), status: w.status, payee: w.payee,
  adminNote: w.adminNote, createdAt: w.createdAt, reviewedAt: w.reviewedAt,
})
const recordId = (id: string, what: string) => {
  if (!/^\d{1,18}$/.test(id)) throw new AppError('NOT_FOUND', `${what}不存在`, 404)
  return id
}

/** 包的参数 / 状态错误 → 接口 4xx（中文提示原样给前端） */
export async function fx<T>(run: () => Promise<T>): Promise<T> {
  try { return await run() } catch (e) {
    if (e instanceof FenxiaoError) throw new AppError(e.code, e.message, HTTP_STATUS_BY_CODE[e.code] ?? 400)
    throw e
  }
}

export class FenxiaoService {
  constructor(private readonly store: PgStore) {}
  private get f() { return this.store.fx }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter(Boolean))]
    if (uniq.length === 0) return new Map()
    const r = await this.store.pool.query('SELECT id::text AS id,username FROM users WHERE id::text=ANY($1::text[])', [uniq])
    return new Map(r.rows.map((x: { id: string; username: string }) => [x.id, x.username]))
  }
  private async userIdByName(username: string): Promise<string> {
    const r = await this.store.pool.query('SELECT id::text AS id FROM users WHERE username=$1', [username.trim().toLowerCase()])
    if (!r.rows[0]) throw new AppError('NOT_FOUND', `用户 ${username} 不存在`, 404)
    return r.rows[0].id as string
  }
  private memberView(m: FxMember, names: Map<string, string>, policy: FenxiaoPolicyInput) {
    return {
      userId: m.userId, username: names.get(m.userId) ?? '(已删除)', parentUserId: m.parentUserId,
      parentUsername: m.parentUserId ? names.get(m.parentUserId) ?? '(已删除)' : null,
      code: m.code, tierCode: m.tierCode, tierName: policy.tiers.find(t => t.code === m.tierCode)?.name ?? null,
      enabled: m.enabled, rateOverride: m.rateOverride, note: m.note, boundAt: m.boundAt, createdAt: m.createdAt,
    }
  }

  // ---- 推广人自己 ----
  async me(userId: string) {
    const policy = await readFenxiaoPolicy(this.store.pool)
    let member = await this.f.getMember(userId)
    const tier = policy.tiers.find(t => t.code === member?.tierCode) ?? null
    const eligible = (member ? member.enabled : true) && (policy.openToAll || !!tier)
    if (policy.enabled && eligible && !member?.code) member = await fx(() => this.f.ensureCode(userId))
    const [account, team] = await Promise.all([this.f.account(userId), this.f.teamStats(userId)])
    const parentName = member?.parentUserId ? (await this.names([member.parentUserId])).get(member.parentUserId) : null
    return {
      enabled: policy.enabled, eligible, code: eligible ? member?.code ?? null : null,
      tierName: tier?.name ?? null, rates: member?.rateOverride ?? tier?.rates ?? (policy.openToAll ? policy.defaultRates : []),
      mode: policy.mode, maxLevels: policy.maxLevels, freezeDays: policy.freezeDays, minWithdrawalCents: policy.minWithdrawalCents,
      withdrawalFeeBps: policy.withdrawalFeeBps, withdrawalFeeFixedCents: policy.withdrawalFeeFixedCents,
      inviter: parentName ? maskName(parentName) : null,
      account: accountView(account),
      team: { direct: team.direct, team: team.team, paidOrders: team.paidOrders, commissionCents: n(team.commissionTotal) },
    }
  }
  async myTeam(userId: string, q: { level?: number | undefined; limit: number; offset: number }) {
    const page = await this.f.listDownline({ userId, ...(q.level ? { level: q.level } : {}), limit: q.limit, offset: q.offset })
    const names = await this.names(page.items.map(x => x.userId))
    return { ...page, items: page.items.map(x => ({ username: maskName(names.get(x.userId) ?? '?'), depth: x.depth, boundAt: x.boundAt })) }
  }
  async myCommissions(userId: string, q: { limit: number; offset: number }) {
    const page = await this.f.listCommissions({ beneficiaryUserId: userId, limit: q.limit, offset: q.offset })
    const names = await this.names(page.items.map(x => x.buyerUserId))
    return {
      total: page.total, limit: page.limit, offset: page.offset, amountSumCents: n(page.amountSum),
      items: page.items.map(c => {
        const v = commissionView(c)
        // 风控挂起原因是内部信号，推广人只看到「审核中」；调账给原因（推广人能看）
        const reason = c.status === 'held' ? '审核中' : c.sourceKind === 'adjust' ? c.note : c.reverseReason
        return { id: v.id, kind: c.sourceKind, level: v.level, baseCents: v.baseCents, rateBps: v.rateBps, amountCents: v.amountCents, status: v.status, availableAt: v.availableAt, createdAt: v.createdAt, reason, buyer: c.sourceKind === 'adjust' ? '运营调整' : maskName(names.get(c.buyerUserId) ?? '?') }
      }),
    }
  }
  async myWithdrawals(userId: string, q: { limit: number; offset: number }) {
    const page = await this.f.listWithdrawals({ userId, limit: q.limit, offset: q.offset })
    return { ...page, items: page.items.map(withdrawalView) }
  }
  async withdraw(userId: string, input: { amountCents: number; method: string; account: string; name: string }) {
    const w = await fx(() => this.f.requestWithdrawal({ userId, amount: BigInt(input.amountCents), payee: { method: input.method, account: input.account, name: input.name } }))
    return withdrawalView(w)
  }

  // ---- 后台 ----
  getPolicy() { return readFenxiaoPolicy(this.store.pool) }
  async savePolicy(input: FenxiaoPolicyInput, actor: string) {
    await fx(async () => assertFxPolicy(toFxPolicy(input)))
    await this.store.pool.query(`INSERT INTO system_settings(key,value,updated_by,updated_at) VALUES($1,$2,$3,now())
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`, [FENXIAO_POLICY_KEY, JSON.stringify(input), actor])
    return input
  }
  async overview(days: number) {
    const o = await this.f.overview(new Date(Date.now() - days * 86_400_000))
    return {
      boundMembers: o.boundMembers, agents: o.agents, pendingWithdrawals: o.pendingWithdrawals, heldCommissions: o.heldCommissions, periodCount: o.periodCount,
      frozenCents: n(o.frozen), heldCents: n(o.held), availableCents: n(o.available), withdrawingCents: n(o.withdrawing), withdrawnCents: n(o.withdrawn),
      reversedCents: n(o.reversed), periodCommissionCents: n(o.periodCommission),
    }
  }
  async listMembers(q: FenxiaoMembersQuery) {
    const policy = await this.getPolicy()
    let userIds: string[] | undefined
    if (q.q) {
      const r = await this.store.pool.query(`SELECT id::text AS id FROM users WHERE username ILIKE $1 ESCAPE '\\' LIMIT 100`, [`%${q.q.replace(/[\\%_]/g, '\\$&')}%`])
      userIds = r.rows.map((x: { id: string }) => x.id)
      const byCode = await this.f.findByCode(q.q)
      if (byCode) userIds.push(byCode.userId)
    }
    const page = await this.f.listMembers({ agentsOnly: q.agentsOnly === '1', ...(q.tierCode ? { tierCode: q.tierCode } : {}), ...(q.parentUserId ? { parentUserId: q.parentUserId } : {}), ...(userIds ? { userIds } : {}), limit: q.limit, offset: q.offset })
    const names = await this.names(page.items.flatMap(m => [m.userId, m.parentUserId ?? '']))
    return { ...page, items: page.items.map(m => ({ ...this.memberView(m, names, policy), directCount: m.directCount, teamCount: m.teamCount, account: accountView(m.account) })) }
  }
  async grant(username: string, patch: FenxiaoMemberPatch, operatorId: string) {
    return this.patchMember(await this.userIdByName(username), patch, operatorId)
  }
  async patchMember(userId: string, patch: FenxiaoMemberPatch, operatorId: string) {
    const m = await fx(() => this.f.setMember({
      userId, operatorId,
      ...(patch.tierCode !== undefined ? { tierCode: patch.tierCode } : {}), ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.rateOverride !== undefined ? { rateOverride: patch.rateOverride } : {}), ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.code !== undefined ? { code: patch.code } : {}),
    }))
    return this.memberView(m, await this.names([m.userId, m.parentUserId ?? '']), await this.getPolicy())
  }
  async move(userId: string, parentUsername: string | null, operatorId: string) {
    const parentUserId = parentUsername ? await this.userIdByName(parentUsername) : null
    const m = await fx(() => this.f.moveMember({ userId, parentUserId, operatorId }))
    return this.memberView(m, await this.names([m.userId, m.parentUserId ?? '']), await this.getPolicy())
  }
  async listCommissions(q: FenxiaoCommissionsQuery) {
    const beneficiaryUserId = q.beneficiaryUserId ?? (q.q ? await this.userIdByName(q.q) : undefined)
    const page = await this.f.listCommissions({ ...(beneficiaryUserId ? { beneficiaryUserId } : {}), ...(q.status ? { status: q.status } : {}), limit: q.limit, offset: q.offset })
    const names = await this.names(page.items.flatMap(c => [c.buyerUserId, c.beneficiaryUserId]))
    const refs = [...new Set(page.items.filter(c => c.sourceKind === 'order').map(c => c.sourceRef))]
    const orders = refs.length ? await this.store.pool.query(`SELECT DISTINCT ON (coalesce(group_id::text,id::text)) coalesce(group_id::text,id::text) AS ref,order_no,plan_name
      FROM orders WHERE coalesce(group_id::text,id::text)=ANY($1::text[]) ORDER BY coalesce(group_id::text,id::text),created_at`, [refs]) : { rows: [] }
    const orderOf = new Map(orders.rows.map((x: { ref: string; order_no: string; plan_name: string }) => [x.ref, x]))
    return {
      total: page.total, limit: page.limit, offset: page.offset, amountSumCents: n(page.amountSum),
      items: page.items.map(c => ({ ...commissionView(c), buyer: names.get(c.buyerUserId) ?? '(已删除)', beneficiary: names.get(c.beneficiaryUserId) ?? '(已删除)', orderNo: orderOf.get(c.sourceRef)?.order_no ?? null, planName: orderOf.get(c.sourceRef)?.plan_name ?? null })),
    }
  }
  async reviewCommission(id: string, action: 'approve' | 'void', operatorId: string, note?: string) {
    const c = await fx(() => this.f.reviewCommission({ id: recordId(id, '佣金记录'), action, operatorId, ...(note ? { note } : {}) }))
    return commissionView(c)
  }
  async adjust(username: string, amountCents: number, reason: string, operatorId: string) {
    const userId = await this.userIdByName(username)
    const c = await fx(() => this.f.adjust({ userId, amount: BigInt(amountCents), reason, operatorId }))
    return commissionView(c)
  }
  async listWithdrawals(q: FenxiaoWithdrawalsQuery) {
    const userId = q.q ? await this.userIdByName(q.q) : undefined
    const page = await this.f.listWithdrawals({ ...(userId ? { userId } : {}), ...(q.status ? { status: q.status } : {}), limit: q.limit, offset: q.offset })
    const names = await this.names(page.items.map(w => w.userId))
    return { ...page, items: page.items.map(w => ({ ...withdrawalView(w), username: names.get(w.userId) ?? '(已删除)' })) }
  }
  async review(id: string, action: 'paid' | 'rejected', operatorId: string, note?: string) {
    return withdrawalView(await fx(() => this.f.reviewWithdrawal({ id: recordId(id, '提现单'), action, operatorId, ...(note ? { note } : {}) })))
  }
}
