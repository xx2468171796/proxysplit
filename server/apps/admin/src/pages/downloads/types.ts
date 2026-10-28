// /v1/admin/downloads 返回结构。
export type DownloadStats = {
  summary: { downloads: number; downloadUniqueIps: number; downloadUniqueVisitors: number; views: number; viewUniqueIps: number; viewUniqueVisitors: number }
  daily: { date: string; downloads: number; views: number; downloadIps: number }[]
  versions: { version: string; total: number; uniqueIps: number }[]
  referers: { source: string; total: number }[]
  recent: { kind: 'download' | 'view'; file: string; version: string; referer: string; createdAt: string }[]
}
