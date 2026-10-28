export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message) }
}
export const nowIso = () => new Date().toISOString()
export const normalizeUsername = (value: string) => value.trim().toLowerCase()
/** 大陆手机号归一化：去空格 / 横线 / 括号和 +86 / 0086 / 86 前缀，得到 1[3-9] 开头的 11 位；不像手机号返回 null。 */
export const normalizePhone = (value: string): string | null => {
  let s = value.trim().replace(/[\s\-()]/g, '')
  if (s.startsWith('+86')) s = s.slice(3)
  else if (s.startsWith('0086')) s = s.slice(4)
  else if (s.length === 13 && s.startsWith('86')) s = s.slice(2)
  return /^1[3-9]\d{9}$/.test(s) ? s : null
}
/** 登录框里输入的像手机号（含 +86 / 86 前缀）就先按手机号查。 */
export const looksLikePhone = (value: string) => normalizePhone(value) !== null
/** 手机号中间 4 位打码：13800138000 → 138****8000 */
export const maskPhone = (phone: string | null | undefined) => phone ? (phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : '****') : null
