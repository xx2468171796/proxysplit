import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 分转元展示：¥19.90 */
export function money(cents: number | null | undefined): string {
  return `¥${(Number(cents || 0) / 100).toFixed(2)}`
}

/** ISO 字符串 -> 本地日期时间；空值显示 — */
export function dt(v?: string | null): string {
  return v ? new Date(v).toLocaleString() : '—'
}

/** ISO 字符串 -> 本地日期（不含时间） */
export function dateOnly(v?: string | null): string {
  return v ? new Date(v).toLocaleDateString() : '—'
}
