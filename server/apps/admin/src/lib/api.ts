// 类型化 API 客户端。
// 生产环境下后台 SPA 与 API 同源；本地开发从 server/.env 注入 VITE_API_URL。
const BASE = import.meta.env.VITE_API_URL ?? ''

let token = sessionStorage.getItem('ps-admin-token') || ''

export const setToken = (v: string) => {
  token = v
  if (v) sessionStorage.setItem('ps-admin-token', v)
  else sessionStorage.removeItem('ps-admin-token')
}
export const hasToken = () => !!token
export const logout = () => {
  const had = hasToken()
  setToken('')
  if (had) location.reload()
}

/**
 * 核心请求器。保留原有鉴权行为：
 *  - 附带 Bearer token 与 JSON content-type。
 *  - 401 / ACCESS_INVALID / DEVICE_ACTIVATION_REQUIRED 时清 token 并 reload，
 *    否则每个列表会静默 403，控制台看起来像“数据丢了”。
 *  - 其它错误抛出后端提供的 message。
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  if (token) headers.set('authorization', 'Bearer ' + token)
  const res = await fetch(BASE + path, { ...init, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const code = (data as { error?: { code?: string } })?.error?.code
    if (res.status === 401 || code === 'ACCESS_INVALID' || code === 'DEVICE_ACTIVATION_REQUIRED') {
      const had = hasToken()
      setToken('')
      if (had) location.reload()
    }
    throw new Error((data as { error?: { message?: string } })?.error?.message || `HTTP ${res.status}`)
  }
  return data as T
}

// ---- 方法辅助 ----
export const get = <T>(path: string) => api<T>(path)
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
export const patch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
export const put = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })

// ---- 列表信封 ----
export interface ListEnvelope<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  /** 仅 orders 列表返回：已成交金额合计（分） */
  amountSum?: number
}

/** 列表查询参数：分页/搜索/排序 + 任意实体筛选。值为 undefined/null/'' 会被忽略。 */
export type ListParams = {
  q?: string
  limit?: number
  offset?: number
  sort?: string
  order?: 'asc' | 'desc'
} & Record<string, string | number | boolean | null | undefined>

/** 把参数拼成 query string（跳过空值），返回不含 ? 的字符串。 */
export function toQuery(params: ListParams): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/**
 * 统一列表拉取：`listApi('/v1/admin/users', { q, limit, offset, sort, order, status })`
 * -> 返回 { items, total, limit, offset }（orders 还带 amountSum）。
 */
export function listApi<T>(path: string, params: ListParams = {}): Promise<ListEnvelope<T>> {
  return api<ListEnvelope<T>>(path + toQuery(params))
}

/**
 * 登录：保留设备指纹（localStorage）与设备名额已满的处理。
 * 设备名额已满会返回 15 分钟的 pending token，读不了 admin 数据，绝不能存。
 */
export async function login(username: string, password: string) {
  let fp = localStorage.getItem('ps-admin-device')
  if (!fp) {
    fp = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
    localStorage.setItem('ps-admin-device', fp)
  }
  const data = await api<{ accessToken: string; deviceLimitReached?: boolean }>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      device: { fingerprint: fp, name: '运营后台', platform: 'windows', appVersion: '1.9.0' },
    }),
  })
  if (data.deviceLimitReached || !data.accessToken) {
    throw new Error('设备名额已满，请先在其他设备解绑，或联系管理员')
  }
  setToken(data.accessToken)
}
