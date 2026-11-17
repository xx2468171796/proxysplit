// 登录失败锁定规则（纯函数，一处定义；store.recordLoginFailure 在行锁里调它）。
// 连续输错 threshold 次锁一段时间，再犯逐级加长但封顶；成功登录或隔了 decayHours 没再被锁，级别归零。
// 封顶 + 归零是为了：别人拿你的手机号 / 用户名乱试，最多让你等 maxMinutes，而不是越锁越久。

export const LOGIN_LOCK = { threshold: 5, stepMinutes: 5, maxMinutes: 30, decayHours: 24 } as const

export type LoginLockState = { failedLoginCount: number; lockoutLevel: number; lockedUntil: Date | null }

export const isLoginLocked = (lockedUntil: Date | string | null | undefined, now: Date) =>
  !!lockedUntil && new Date(lockedUntil).getTime() > now.getTime()

/** 又输错一次之后的状态。 */
export function nextLoginFailure(s: LoginLockState, now: Date): LoginLockState {
  const lastLock = s.lockedUntil ? new Date(s.lockedUntil) : null
  const fresh = !!lastLock && now.getTime() - lastLock.getTime() < LOGIN_LOCK.decayHours * 3600_000
  const level = fresh ? s.lockoutLevel : 0
  const failed = s.failedLoginCount + 1
  if (failed < LOGIN_LOCK.threshold) return { failedLoginCount: failed, lockoutLevel: level, lockedUntil: lastLock }
  const next = Math.min(level + 1, LOGIN_LOCK.maxMinutes / LOGIN_LOCK.stepMinutes)
  return { failedLoginCount: 0, lockoutLevel: next, lockedUntil: new Date(now.getTime() + next * LOGIN_LOCK.stepMinutes * 60_000) }
}
