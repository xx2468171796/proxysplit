export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message) }
}
export const nowIso = () => new Date().toISOString()
export const normalizeUsername = (value: string) => value.trim().toLowerCase()
/** 登录框里「纯 11 位、1 开头」按手机号查（归一化在 contracts phoneSchema）。 */
export const looksLikePhone = (value: string) => /^1\d{10}$/.test(value.trim())
/** 手机号中间 4 位打码：13800138000 → 138****8000 */
export const maskPhone = (phone: string | null | undefined) => phone ? (phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : '****') : null
