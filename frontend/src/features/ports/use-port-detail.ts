// 端口详情面板的数据：每 2 秒取一次某端口（可按来访设备过滤）的连接 / 访问日志 / 内核日志。
import { useEffect, useMemo, useState } from "react";
import type { PortDetail } from "../../api/types";
import { fetchPortDetail } from "../../state/ports";

const POLL_MS = 2000;

export function usePortDetail(id: string, client: string): PortDetail | null {
  const [detail, setDetail] = useState<PortDetail | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await fetchPortDetail(id, client);
        if (alive) setDetail(d);
      } catch {
        /* 端口刚被删或后端忙：保留上一次，下个 2 秒再取 */
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, client]);
  return detail;
}

/** 前端分页：数据一次全取，按页切片显示（轮询刷新时停留在当前页）。 */
/** resetKey 变了（换了筛选 / 搜索）就回到第一页；轮询刷新不会变它，停留在当前页。 */
export function usePaged<T>(rows: readonly T[], size = 50, resetKey = "") {
  const [page, setPage] = useState(1);
  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setPage(1);
  }
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const slice = useMemo(() => rows.slice((current - 1) * size, current * size), [rows, current, size]);
  const pagination = {
    mode: "page" as const,
    total: rows.length,
    page: current,
    pageSize: size,
    pageSizes: [size],
    onPageChange: setPage,
    onPageSizeChange: () => undefined,
  };
  return { slice, pagination };
}

/** 给没有唯一键的行补键：相同内容的行带上序号。 */
export function withKeys<T>(rows: readonly T[], baseOf: (row: T) => string): (T & { key: string })[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = baseOf(row);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...row, key: `${base}#${n}` };
  });
}
