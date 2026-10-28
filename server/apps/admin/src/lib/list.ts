// 服务端分页列表：把 admin-ui 的 ListQuery 翻成后端的 q / limit / offset / sort / order（或 page / pageSize），
// 用 useDataSource 管取消、过期响应和刷新；页面只关心列、筛选和动作。
import * as React from 'react'
import { useDataSource, type ListAdapter, type ListQuery, type Sort } from '@ankotti/admin-ui'
import { get, toQuery, type ListEnvelope, type QueryParams } from './api'

export type Filters = Record<string, string>

export type ServerListOptions<F extends Filters> = {
  filters: F
  sort?: Sort
  pageSize?: number
  /** 额外参数（日期范围、上级 id 等），变化时回第 1 页。 */
  extra?: QueryParams
  /** 后端分页参数风格：默认 limit / offset，同事节点接口用 page / pageSize。 */
  paging?: 'offset' | 'page'
  initialSearch?: string
  /** 打开时带的筛选（下钻），「重置」回到 filters。 */
  initialFilters?: Partial<F> | undefined
}

const EXTRA_KEY = '__extra'

export type ListMeta = { amountSum?: number | string | undefined; amountSumCents?: number | string | undefined }

export function listParams<F extends Filters>(query: ListQuery<F>, extra: QueryParams, paging: 'offset' | 'page'): QueryParams {
  const base: QueryParams = paging === 'page'
    ? { page: query.page, pageSize: query.pageSize }
    : { limit: query.pageSize, offset: (query.page - 1) * query.pageSize }
  return {
    q: query.search,
    ...base,
    ...(query.sort ? { sort: query.sort.key, order: query.sort.direction } : {}),
    ...Object.fromEntries(Object.entries(query.filters).filter(([k]) => k !== EXTRA_KEY)),
    ...extra,
  }
}

export function useServerList<T, F extends Filters>(path: string, opts: ServerListOptions<F>) {
  const paging = opts.paging ?? 'offset'
  const [query, setQuery] = React.useState<ListQuery<F>>(() => ({
    page: 1, pageSize: opts.pageSize ?? 20, search: opts.initialSearch ?? '', filters: { ...opts.filters, ...opts.initialFilters }, ...(opts.sort ? { sort: opts.sort } : {}),
  }))
  const [draft, setDraft] = React.useState(opts.initialSearch ?? '')
  const [meta, setMeta] = React.useState<ListMeta>({})
  const extraKey = JSON.stringify(opts.extra ?? {})
  const extraRef = React.useRef(opts.extra ?? {})
  extraRef.current = opts.extra ?? {}
  const firstExtra = React.useRef(true)
  React.useEffect(() => {
    if (firstExtra.current) { firstExtra.current = false; return }
    setQuery((q) => ({ ...q, page: 1 }))
  }, [extraKey])

  const adapter = React.useCallback<ListAdapter<T, F>>(async (q, { signal }) => {
    const env = await get<ListEnvelope<T>>(path + toQuery(listParams(q, extraRef.current, paging)), signal)
    setMeta({ amountSum: env.amountSum, amountSumCents: env.amountSumCents })
    return { rows: env.items, total: env.total }
  }, [path, paging])
  // extraKey 进 query 比较键，参数变了才会重新请求。
  const keyed = React.useMemo(() => ({ ...query, filters: { ...query.filters, [EXTRA_KEY]: extraKey } as F }), [query, extraKey])
  const source = useDataSource(adapter, keyed)

  const setFilter = (key: keyof F & string, value: string) => setQuery((q) => ({ ...q, page: 1, filters: { ...q.filters, [key]: value } }))
  const search = () => setQuery((q) => ({ ...q, page: 1, search: draft.trim() }))
  const reset = () => { setDraft(''); setQuery((q) => ({ ...q, page: 1, search: '', filters: opts.filters })) }
  const searchFor = (text: string) => { setDraft(text); setQuery((q) => ({ ...q, page: 1, search: text })) }
  const filtered = query.search !== '' || Object.entries(query.filters).some(([k, v]) => v !== '' && v !== opts.filters[k])
  const total = source.data?.total

  return {
    query, meta, source, total, filtered, setFilter, searchFor,
    /** 展开到 ResourcePanel：数量只在拿到真实总数后显示。 */
    panel: { ...(total !== undefined ? { count: total } : {}), loading: source.loading },
    queryBar: {
      value: draft, onChange: setDraft, onSearch: search, onReset: reset,
      hits: filtered ? total ?? null : null, canReset: filtered,
    },
    table: {
      rows: source.data?.rows ?? [],
      loading: source.loading,
      refreshing: source.refreshing,
      ...(source.error ? { error: source.error } : {}),
      onRetry: () => source.reload(),
      emptyKind: filtered ? 'no-results' as const : 'empty' as const,
      ...(query.sort ? { sort: query.sort } : {}),
      onSortChange: (sort: Sort) => setQuery((q) => ({ ...q, page: 1, sort })),
      pagination: {
        mode: 'page' as const, total: total ?? 0, page: query.page, pageSize: query.pageSize,
        onPageChange: (page: number) => setQuery((q) => ({ ...q, page })),
        onPageSizeChange: (pageSize: number) => setQuery((q) => ({ ...q, page: 1, pageSize })),
        pageSizes: [10, 20, 50, 100],
      },
    },
    refresh: () => source.refresh(),
  }
}
