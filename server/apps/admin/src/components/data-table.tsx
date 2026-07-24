import * as React from 'react'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** 传给数据获取函数的查询状态。 */
export interface DataTableQuery {
  q: string
  limit: number
  offset: number
  sort?: string
  order?: 'asc' | 'desc'
  /** 各 faceted 筛选的当前值（仅包含已选中的）。 */
  filters: Record<string, string>
}

export interface DataTableFetchResult<T> {
  items: T[]
  total: number
  limit?: number
  offset?: number
  /** 可选透传（如 orders 的 amountSum，分）。 */
  amountSum?: number
}

export type DataTableFetcher<T> = (query: DataTableQuery) => Promise<DataTableFetchResult<T>>

export interface FacetOption {
  label: string
  value: string
}

/** faceted 筛选下拉定义。key 会作为 query 参数名传给后端。 */
export interface FacetFilter {
  key: string
  label: string
  options: FacetOption[]
}

/**
 * 列的额外元信息。放在 ColumnDef.meta 上：
 *  - sortKey：设置后该列可排序，值为后端排序白名单里的列名。
 *  - className：附加到该列单元格。
 *  - headerClassName：附加到表头。
 */
export interface ColumnMeta {
  sortKey?: string
  className?: string
  headerClassName?: string
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  /** 数据获取函数，接收 {q,limit,offset,sort,order,filters}，返回 {items,total,...}。 */
  fetcher: DataTableFetcher<T>
  /** 是否显示关键字搜索框（对应 q）。 */
  searchable?: boolean
  searchPlaceholder?: string
  /** faceted 筛选下拉定义列表。 */
  filters?: FacetFilter[]
  /**
   * 受控的额外查询参数（日期范围等 faceted 之外的筛选）。
   * 会并入传给 fetcher 的 filters；空值自动忽略；变化时回到第一页并重新拉取。
   */
  extraParams?: Record<string, string | number | boolean | null | undefined>
  /** 初始排序。 */
  initialSort?: { sort: string; order: 'asc' | 'desc' }
  /** 每页条数默认值与可选项。 */
  pageSize?: number
  pageSizeOptions?: number[]
  /** 工具栏右侧自定义内容（通常是“新建”按钮）。 */
  toolbar?: React.ReactNode
  /** 变化时强制刷新（父组件写操作后 +1 即可）。 */
  refreshSignal?: number
  /** 每次拉取成功后回调，可用于读取 total / amountSum 等。 */
  onLoaded?: (result: DataTableFetchResult<T>) => void
  /** 空数据文案。 */
  emptyText?: string
  /** 行 key 提取（默认取 row.id）。 */
  getRowId?: (row: T, index: number) => string
}

const DEBOUNCE_MS = 300

export function DataTable<T>({
  columns,
  fetcher,
  searchable = true,
  searchPlaceholder = '搜索…',
  filters = [],
  extraParams,
  initialSort,
  pageSize = 20,
  pageSizeOptions = [10, 20, 50, 100],
  toolbar,
  refreshSignal = 0,
  onLoaded,
  emptyText = '暂无数据',
  getRowId,
}: DataTableProps<T>) {
  const [q, setQ] = React.useState('')
  const [debouncedQ, setDebouncedQ] = React.useState('')
  const [limit, setLimit] = React.useState(pageSize)
  const [offset, setOffset] = React.useState(0)
  const [sort, setSort] = React.useState<string | undefined>(initialSort?.sort)
  const [order, setOrder] = React.useState<'asc' | 'desc' | undefined>(initialSort?.order)
  const [facet, setFacet] = React.useState<Record<string, string>>({})

  const [items, setItems] = React.useState<T[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')

  // 关键字防抖
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [q])

  // 规范化额外参数（去空值 -> string），并用其序列化形式作为依赖。
  const normalizedExtra = React.useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(extraParams ?? {})) {
      if (v === undefined || v === null || v === '') continue
      out[k] = String(v)
    }
    return out
  }, [extraParams])
  const extraKey = JSON.stringify(normalizedExtra)

  // 任何筛选/搜索/排序变化都回到第一页
  React.useEffect(() => {
    setOffset(0)
  }, [debouncedQ, limit, sort, order, facet, extraKey])

  const onLoadedRef = React.useRef(onLoaded)
  onLoadedRef.current = onLoaded

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const query: DataTableQuery = {
      q: debouncedQ,
      limit,
      offset,
      filters: { ...facet, ...normalizedExtra },
      ...(sort ? { sort } : {}),
      ...(order ? { order } : {}),
    }
    fetcher(query)
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
        setTotal(res.total)
        onLoadedRef.current?.(res)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setItems([])
        setTotal(0)
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, limit, offset, sort, order, facet, extraKey, refreshSignal])

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: Math.max(1, Math.ceil(total / limit)),
    ...(getRowId ? { getRowId } : {}),
  })

  function toggleSort(key: string) {
    if (sort !== key) {
      setSort(key)
      setOrder('asc')
    } else if (order === 'asc') {
      setOrder('desc')
    } else {
      setSort(undefined)
      setOrder(undefined)
    }
  }

  const page = Math.floor(offset / limit) + 1
  const pageCount = Math.max(1, Math.ceil(total / limit))
  const activeFacetCount = Object.values(facet).filter(Boolean).length
  const hasFilters = searchable || filters.length > 0

  return (
    <div className="space-y-3">
      {(hasFilters || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 w-[220px] pl-8"
              />
            </div>
          )}
          {filters.map((f) => (
            <Select
              key={f.key}
              value={facet[f.key] ?? '__all__'}
              onValueChange={(v) =>
                setFacet((prev) => {
                  const next = { ...prev }
                  if (v === '__all__') delete next[f.key]
                  else next[f.key] = v
                  return next
                })
              }
            >
              <SelectTrigger className="h-9 w-auto min-w-[120px] gap-1">
                <SelectValue placeholder={f.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{f.label}（全部）</SelectItem>
                {f.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
          {activeFacetCount > 0 && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setFacet({})}>
              <X className="mr-1 h-4 w-4" />
              清除筛选
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">{toolbar}</div>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => {
                  const meta = (header.column.columnDef.meta ?? {}) as ColumnMeta
                  const sortKey = meta.sortKey
                  return (
                    <TableHead key={header.id} className={cn(meta.headerClassName)}>
                      {header.isPlaceholder ? null : sortKey ? (
                        <button
                          type="button"
                          className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground"
                          onClick={() => toggleSort(sortKey)}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sort === sortKey ? (
                            order === 'asc' ? (
                              <ArrowUp className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5" />
                            )
                          ) : (
                            <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, r) => (
                <TableRow key={`sk-${r}`} className="hover:bg-transparent">
                  {columns.map((_c, c) => (
                    <TableCell key={c}>
                      <Skeleton className="h-5 w-full max-w-[160px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : error ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-24 text-center text-destructive">
                  {error}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const meta = (cell.column.columnDef.meta ?? {}) as ColumnMeta
                    return (
                      <TableCell key={cell.id} className={cn(meta.className)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <div>
          共 <span className="font-medium text-foreground">{total}</span> 条
          {activeFacetCount > 0 && '（已筛选）'}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span>每页</span>
            <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
              <SelectTrigger className="h-8 w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[80px] text-center">
            第 {page} / {pageCount} 页
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={loading || offset <= 0}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={loading || page >= pageCount}
              onClick={() => setOffset((o) => o + limit)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
