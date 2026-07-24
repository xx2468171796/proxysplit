// 拆单分付 — 支付宝/收钱吧单笔风控限额期间的方案（对齐统一收款 5ff）。
// 关闭时把 SPLIT_ENABLED 改 false 即恢复单笔。
export const SPLIT_ENABLED = true
export const SPLIT_PER_PIECE_MAX = 199.9 // 每笔金额上限（元），单笔限额内
export const SPLIT_ABSORB_BELOW = 1 // 余额 < 此值（元）则吞掉少收，不单独成一笔
export const SPLIT_MAX_PIECES = 5 // 封顶笔数，超出引导客服

export type SplitPlan =
  | { kind: 'single' }
  | { kind: 'split'; pieces: number[]; absorbed: number }
  | { kind: 'tooLarge' }

const round2 = (n: number) => Math.round(n * 100) / 100

// planSplit 按每笔上限把总额（元）拆成若干笔。≤上限或开关关闭时不拆。
export function planSplit(total: number): SplitPlan {
  const t = round2(total)
  if (!SPLIT_ENABLED || t <= SPLIT_PER_PIECE_MAX) return { kind: 'single' }
  const n = Math.floor(t / SPLIT_PER_PIECE_MAX)
  const rem = round2(t - n * SPLIT_PER_PIECE_MAX)
  let pieces: number[]
  let absorbed = 0
  if (rem < SPLIT_ABSORB_BELOW) {
    pieces = Array(n).fill(SPLIT_PER_PIECE_MAX)
    absorbed = rem
  } else {
    pieces = [...Array(n).fill(SPLIT_PER_PIECE_MAX), rem]
  }
  if (pieces.length > SPLIT_MAX_PIECES) return { kind: 'tooLarge' }
  return { kind: 'split', pieces, absorbed }
}
