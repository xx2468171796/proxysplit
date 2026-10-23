// 多级分销接线：公司 SDK tuiguang/fenxiao（vendor 在 ./vendor/fenxiao，tag 见其 VERSION）。
// 规则存 system_settings.fenxiao_policy（金额是人民币分），缺省 = 关：发版零行为变化，后台打开才分佣。
// 三个接入点在 store.ts：注册建号事务里 bind、grantWithinTx(source='order') 里 settle、refundOrder 里 reverse。
import type { PgStore } from './store.js'
import { fenxiaoPolicySchema, type FenxiaoPolicyInput } from '@proxysplit/contracts'
import { createFenxiao, type FxPolicy, type FxQueryable } from './vendor/fenxiao/index.js'

export const FENXIAO_POLICY_KEY = 'fenxiao_policy'

export const defaultFenxiaoPolicy: FenxiaoPolicyInput = {
  enabled: false,
  mode: 'level',
  maxLevels: 2,
  openToAll: false,
  defaultRates: [1000, 300],
  tiers: [
    { code: 'agent', name: '分销商', rates: [2000, 500] },
    { code: 'dealer', name: '经销商', rates: [3000, 1000] },
  ],
  totalCapBps: 4000,
  freezeDays: 7,
  minBaseCents: 0,
  minWithdrawalCents: 1000,
}

export function toFxPolicy(p: FenxiaoPolicyInput): FxPolicy {
  return {
    enabled: p.enabled, mode: p.mode, maxLevels: p.maxLevels, openToAll: p.openToAll,
    defaultRates: p.defaultRates, tiers: p.tiers, totalCapBps: p.totalCapBps, freezeDays: p.freezeDays,
    minBaseAmount: BigInt(p.minBaseCents), minWithdrawal: BigInt(p.minWithdrawalCents),
  }
}

/** 读库里的规则；没有或坏了（手改过库）都按缺省（关）处理，不让一条坏配置把付款弄挂。 */
export async function readFenxiaoPolicy(db: FxQueryable): Promise<FenxiaoPolicyInput> {
  const r = await db.query('SELECT value FROM system_settings WHERE key=$1', [FENXIAO_POLICY_KEY])
  const row = r.rows[0] as { value?: unknown } | undefined
  const parsed = fenxiaoPolicySchema.safeParse(row?.value)
  return parsed.success ? parsed.data : defaultFenxiaoPolicy
}

export function createProxysplitFenxiao(pool: PgStore['pool']) {
  return createFenxiao({
    db: pool,
    // 在付款 / 注册事务里调时 db 就是那个事务：读规则走它，不另借连接
    getPolicy: async (db) => toFxPolicy(await readFenxiaoPolicy(db)),
    onWarn: (message, err) => console.warn(`[fenxiao] ${message}`, err),
  })
}

export type ProxysplitFenxiao = ReturnType<typeof createProxysplitFenxiao>
