// 类型化 API 客户端。生产环境下后台 SPA 与 API 同源；本地开发从 server/.env 注入 VITE_API_URL。
const BASE: string = import.meta.env.VITE_API_URL ?? ''
const TOKEN_KEY = 'ps-admin-token'
const DEVICE_KEY = 'ps-admin-device'

let token = sessionStorage.getItem(TOKEN_KEY) || ''

export const setToken = (v: string) => {
  token = v
  if (v) sessionStorage.setItem(TOKEN_KEY, v)
  else sessionStorage.removeItem(TOKEN_KEY)
}
export const hasToken = () => !!token
export const logout = () => {
  const had = hasToken()
  setToken('')
  if (had) location.reload()
}

type ErrorBody = { error?: { code?: string; message?: string } }

/**
 * 核心请求器：带 Bearer token 与 JSON；401 / ACCESS_INVALID / DEVICE_ACTIVATION_REQUIRED 清 token 并刷新
 * （否则每个列表静默 403，看起来像「数据丢了」）；其它错误抛后端给的 message。
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if (token) headers.set('authorization', 'Bearer ' + token)
  const res = await fetch(BASE + path, { ...init, headers })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const body = data as ErrorBody
    const code = body?.error?.code
    if (res.status === 401 || code === 'ACCESS_INVALID' || code === 'DEVICE_ACTIVATION_REQUIRED') {
      const had = hasToken()
      setToken('')
      if (had) location.reload()
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`)
  }
  return data as T
}

const withBody = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  ...(signal ? { signal } : {}),
})

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, signal ? { signal } : {})
export const post = <T>(path: string, body?: unknown) => api<T>(path, withBody('POST', body))
export const patch = <T>(path: string, body?: unknown) => api<T>(path, withBody('PATCH', body))
export const put = <T>(path: string, body?: unknown) => api<T>(path, withBody('PUT', body))
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })

/** 列表信封：所有 /v1/admin 列表都回 { items, total, limit, offset }，订单另带 amountSum、佣金带 amountSumCents。 */
export type ListEnvelope<T> = {
  items: T[]
  total: number
  limit?: number
  offset?: number
  amountSum?: number | string
  amountSumCents?: number | string
}

export type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue>

/** 拼 query string（跳过空值），返回带 ? 的字符串或空串。 */
export function toQuery(params: QueryParams): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/**
 * 登录：保留设备指纹（localStorage）与设备名额已满的处理。
 * 名额已满会返回 15 分钟的 pending token，读不了 admin 数据，绝不能存。
 */
export async function login(username: string, password: string) {
  let fp = localStorage.getItem(DEVICE_KEY)
  if (!fp) {
    fp = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
    localStorage.setItem(DEVICE_KEY, fp)
  }
  const data = await api<{ accessToken?: string; deviceLimitReached?: boolean }>('/v1/auth/login', withBody('POST', {
    username,
    password,
    device: { fingerprint: fp, name: '运营后台', platform: 'windows', appVersion: '1.9.0' },
  }))
  if (data.deviceLimitReached || !data.accessToken) throw new Error('设备名额已满，请先在其他设备解绑，或联系管理员')
  setToken(data.accessToken)
}
