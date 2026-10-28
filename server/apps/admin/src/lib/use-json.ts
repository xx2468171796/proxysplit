// 单个 GET 资源：换地址取消旧请求；refresh() 保留旧数据，失败进 staleError；可按间隔在页面可见时刷新。
import * as React from 'react'
import { errorText } from '@ankotti/admin-ui'
import { get } from './api'

export type JsonState<T> = { data?: T; error?: string; staleError?: string; loading: boolean; refreshing: boolean; at?: number }

export function useJson<T>(path: string | null, opts: { intervalMs?: number; active?: boolean } = {}) {
  const [state, setState] = React.useState<JsonState<T>>({ loading: !!path, refreshing: false })
  const [tick, setTick] = React.useState({ n: 0, silent: false })
  React.useEffect(() => {
    if (!path) return
    const ac = new AbortController()
    setState((s) => (tick.silent && s.data ? { ...s, refreshing: true } : { loading: true, refreshing: false }))
    get<T>(path, ac.signal)
      .then((data) => setState({ data, loading: false, refreshing: false, at: Date.now() }))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        const msg = errorText(e, '加载失败')
        setState((s) => (s.data ? { ...s, refreshing: false, staleError: msg } : { loading: false, refreshing: false, error: msg }))
      })
    return () => ac.abort()
  }, [path, tick])
  const active = opts.active ?? true
  React.useEffect(() => {
    if (!opts.intervalMs || !active) return
    const id = setInterval(() => { if (document.visibilityState === 'visible') setTick((t) => ({ n: t.n + 1, silent: true })) }, opts.intervalMs)
    return () => clearInterval(id)
  }, [opts.intervalMs, active])
  return {
    ...state,
    reload: () => setTick((t) => ({ n: t.n + 1, silent: false })),
    refresh: () => setTick((t) => ({ n: t.n + 1, silent: true })),
  }
}
