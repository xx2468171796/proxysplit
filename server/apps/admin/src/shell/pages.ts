// 菜单与页面注册：每个页面按需懒加载（打开标签时才下载），图表页连同 echarts 一起拆包。
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import {
  Activity, BadgePercent, Boxes, CreditCard, Download, FileClock, Gauge, Gift, Laptop, Megaphone,
  ReceiptText, Rocket, Settings, Share2, Users,
} from 'lucide-react'
import type { NavItem } from '@ankotti/admin-ui'
import type { PageProps } from './workspace-context'

type Page = LazyExoticComponent<ComponentType<PageProps>>
const page = <M,>(load: () => Promise<M>, pick: (m: M) => ComponentType<PageProps>): Page =>
  lazy(async () => ({ default: pick(await load()) }))

export const NAVIGATION: NavItem[] = [
  { id: 'overview', title: '运营总览', icon: Gauge, keywords: '概览 看板 首页 dashboard' },
  { id: 'users', title: '用户与会员', icon: Users, group: '用户与会员', keywords: '用户 会员 授权 手机号' },
  { id: 'devices', title: '设备', icon: Laptop, group: '用户与会员', keywords: '设备 解绑 在线' },
  { id: 'plans', title: '套餐', icon: Boxes, group: '用户与会员', keywords: '套餐 价格 会员' },
  { id: 'redeem', title: '兑换码', icon: Gift, group: '用户与会员', keywords: '兑换码 卡密 批次' },
  { id: 'orders', title: '订单', icon: ReceiptText, group: '交易与支付', keywords: '订单 退款 拆单 补单' },
  { id: 'payments', title: '支付通道', icon: CreditCard, group: '交易与支付', keywords: '支付 通道 收款' },
  { id: 'fenxiao', title: '分销', icon: BadgePercent, group: '推广返利', keywords: '分销 推广 佣金 提现 返利' },
  { id: 'announcements', title: '公告', icon: Megaphone, group: '内容与发布', keywords: '公告 维护 通知' },
  { id: 'releases', title: '版本', icon: Rocket, group: '内容与发布', keywords: '版本 发布 更新 安装包' },
  { id: 'downloads', title: '下载统计', icon: Download, group: '内容与发布', keywords: '下载 浏览 官网' },
  { id: 'client-logs', title: '客户端日志', icon: Activity, group: '客户端运维', keywords: '日志 遥测 失败 telemetry' },
  { id: 'client-nodes', title: '同事节点', icon: Share2, group: '客户端运维', keywords: '节点 订阅 上报' },
  { id: 'audit', title: '审计日志', icon: FileClock, group: '系统', keywords: '审计 操作记录' },
  { id: 'settings', title: '商业设置', icon: Settings, group: '系统', keywords: '设置 注册 试用 设备数' },
]

export const PAGES: Record<string, Page> = {
  overview: page(() => import('../pages/overview/overview-page'), (m) => m.OverviewPage),
  users: page(() => import('../pages/users/users-page'), (m) => m.UsersPage),
  devices: page(() => import('../pages/devices-page'), (m) => m.DevicesPage),
  plans: page(() => import('../pages/plans/plans-page'), (m) => m.PlansPage),
  redeem: page(() => import('../pages/redeem/redeem-page'), (m) => m.RedeemPage),
  orders: page(() => import('../pages/orders/orders-page'), (m) => m.OrdersPage),
  payments: page(() => import('../pages/payments/payments-page'), (m) => m.PaymentsPage),
  fenxiao: page(() => import('../pages/fenxiao/fenxiao-page'), (m) => m.FenxiaoPage),
  announcements: page(() => import('../pages/announcements/announcements-page'), (m) => m.AnnouncementsPage),
  releases: page(() => import('../pages/releases/releases-page'), (m) => m.ReleasesPage),
  downloads: page(() => import('../pages/downloads/downloads-page'), (m) => m.DownloadsPage),
  'client-logs': page(() => import('../pages/client-logs/client-logs-page'), (m) => m.ClientLogsPage),
  'client-nodes': page(() => import('../pages/client-nodes/client-nodes-page'), (m) => m.ClientNodesPage),
  audit: page(() => import('../pages/audit-page'), (m) => m.AuditPage),
  settings: page(() => import('../pages/settings-page'), (m) => m.SettingsPage),
}

export const UserDetailPage = lazy(async () => ({ default: (await import('../pages/users/user-detail-page')).UserDetailPage }))

