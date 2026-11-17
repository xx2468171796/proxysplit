// 试用资格与注册来源限额（唯一归属）：注册发试用（store.registerTrialUser）和登录补发（store.claimTrialOnLogin）都只问这里。
// 规则：一个「核实过的身份」（短信验证过的手机号 / 合作方账号）一辈子领一次；两样都没有的账号不发；
// 同一台电脑（硬件摘要）领过也不发（辅助信号）。已发出去的试用不受影响。
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

type Row = Record<string, unknown>
export type TrialTx = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[]; rowCount?: number | null }> }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/**
 * 限额 / 风控用的来源键：IPv4 用地址本身；IPv6 取前 64 位（一户宽带 / 一台手机拿到的是整个 /64，按单个地址数等于不限）。
 * `::ffff:1.2.3.4` 按 IPv4 算。认不出来的原样返回。
 */
export function ipKey(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/%.*$/, '')
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(raw)
  if (mapped?.[1]) return mapped[1]
  if (isIP(raw) !== 6) return raw
  const [head = '', tail = ''] = raw.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = raw.includes('::') ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return `${groups.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`
}

/** users.registration_ip_hash / trial_claims.ip_hash 的值。IPv4 与历史数据算法一致。 */
export const ipHash = (ip: string) => sha256('proxysplit-ip-v1:' + ipKey(ip))

export type TrialIdentity = { kind: string; hash: string }
/** 身份摘要（不存手机号明文：账号删除后这行还要留着）。迁移 0026 用同一算法回填。 */
export const trialIdentity = (kind: string, value: string): TrialIdentity => ({ kind, hash: sha256(`proxysplit-trial-identity-v1:${kind}:${value}`) })

/** 账号现有的核实身份：绑定的手机号（注册 / 补绑都要短信验证码）+ 每个合作方账号。 */
export async function verifiedIdentitiesOf(tx: TrialTx, userId: string): Promise<TrialIdentity[]> {
  const r = await tx.query(`SELECT 'phone' AS kind,phone AS value FROM users WHERE id=$1 AND phone IS NOT NULL
    UNION ALL SELECT provider,external_id FROM user_identities WHERE user_id=$1`, [userId])
  return r.rows.map(x => trialIdentity(String(x.kind), String(x.value)))
}

export type TrialRefusal = 'disabled' | 'no_identity' | 'no_hardware' | 'identity_claimed' | 'hardware_claimed' | 'no_plan'
export type TrialDecision =
  | { grant: true; days: number; planId: string; identities: TrialIdentity[] }
  | { grant: false; reason: TrialRefusal }

/**
 * 这次能不能发试用。调用方已在事务里；这里按「硬件 → 身份（排序）」的固定顺序上事务级锁，两个并发请求不会各发一次。
 * `settings` 是 system_settings 的 key → value。
 */
export async function decideTrial(tx: TrialTx, input: { identities: TrialIdentity[]; hardwareHash: string; settings: Map<string, unknown> }): Promise<TrialDecision> {
  const days = Number(input.settings.get('trial_days') ?? 3)
  if (!(days > 0)) return { grant: false, reason: 'disabled' }
  if (!input.identities.length) return { grant: false, reason: 'no_identity' }
  if (!input.hardwareHash) return { grant: false, reason: 'no_hardware' }
  const hashes = [...new Set(input.identities.map(i => i.hash))].sort()
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.hardwareHash])
  for (const h of hashes) await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`trial-identity:${h}`])
  const byIdentity = await tx.query('SELECT 1 FROM trial_identity_claims WHERE identity_hash=ANY($1::text[]) LIMIT 1', [hashes])
  if (byIdentity.rows.length) return { grant: false, reason: 'identity_claimed' }
  const byHardware = await tx.query('SELECT 1 FROM trial_claims WHERE hardware_hash=$1', [input.hardwareHash])
  if (byHardware.rows.length) return { grant: false, reason: 'hardware_claimed' }
  const plan = await tx.query('SELECT id FROM plans WHERE code=$1 AND active=true', [String(input.settings.get('trial_plan_code') ?? 'trial')])
  const planId = plan.rows[0]?.id
  if (typeof planId !== 'string') return { grant: false, reason: 'no_plan' }
  return { grant: true, days, planId, identities: input.identities }
}

/** 发放：授权 + 硬件领取记录 + 每个身份一条领取记录 + 账号上的试用起止。与 decideTrial 同一事务。 */
export async function grantTrial(tx: TrialTx, d: Extract<TrialDecision, { grant: true }>, input: { userId: string; hardwareHash: string; ip: string; now?: Date }) {
  const now = input.now ?? new Date(), ends = new Date(now.getTime() + d.days * 86_400_000)
  await tx.query(`INSERT INTO licenses(user_id,plan_id,starts_at,expires_at,source) VALUES($1,$2,$3,$4,'trial')`, [input.userId, d.planId, now, ends])
  await tx.query('INSERT INTO trial_claims(hardware_hash,user_id,expires_at,ip_hash) VALUES($1,$2,$3,$4)', [input.hardwareHash, input.userId, ends, ipHash(input.ip)])
  await tx.query(`INSERT INTO trial_identity_claims(identity_hash,kind,user_id,claimed_at)
    SELECT h,k,$3,$4 FROM unnest($1::text[],$2::text[]) AS t(h,k) ON CONFLICT(identity_hash) DO NOTHING`,
  [d.identities.map(i => i.hash), d.identities.map(i => i.kind), input.userId, now])
  await tx.query('UPDATE users SET trial_started_at=$2,trial_ends_at=$3 WHERE id=$1', [input.userId, now, ends])
  return { trialDays: d.days, trialEndsAt: ends }
}

export const REGISTRATION_WINDOW_HOURS = 24
/**
 * 同一来源（ipKey）24 小时内最多注册 max 个账号（官网和客户端注册都算进同一个数里，各用各的上限）；max<=0 不限。
 * 超了抛 Error('IP_ACCOUNT_LIMIT')。调用方已在事务里；这里先上来源锁，并发注册不会一起挤过去。
 */
export async function assertIpRegistrationBudget(tx: TrialTx, ip: string, max: number) {
  if (!(max > 0)) return
  const hash = ipHash(ip)
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`reg-ip:${hash}`])
  const r = await tx.query(`SELECT count(*)::int AS n FROM users WHERE registration_ip_hash=$1 AND created_at>now()-interval '${REGISTRATION_WINDOW_HOURS} hours'`, [hash])
  if (Number(r.rows[0]?.n ?? 0) >= max) throw new Error('IP_ACCOUNT_LIMIT')
}

/**
 * 账号绑上（或换成）一个新手机号时调，和改手机号同一个事务：这个账号要是已经领过试用，新号也记成领过——
 * 否则领完换绑一个号，再拿新号注册一个账号又能领一次。没领过的账号什么都不写；重复不报错。
 */
export async function carryTrialClaimToPhone(tx: TrialTx, userId: string, phone: string) {
  await tx.query(`INSERT INTO trial_identity_claims(identity_hash,kind,user_id,claimed_at)
    SELECT $2,'phone',u.id,COALESCE(u.trial_started_at,(SELECT min(c.claimed_at) FROM trial_claims c WHERE c.user_id=u.id),now())
    FROM users u WHERE u.id=$1 AND (u.trial_started_at IS NOT NULL OR EXISTS(SELECT 1 FROM trial_claims c WHERE c.user_id=u.id))
    ON CONFLICT(identity_hash) DO NOTHING`, [userId, trialIdentity('phone', phone).hash])
}
