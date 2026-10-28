// 客户端日志：共享类型与词表（接口见 server/apps/api/src/telemetry-routes.ts）。
import type { StatusTone } from '@ankotti/admin-ui'

export type TelemetryStatus = 'ok' | 'fail' | 'info'

export type TelemetryDeviceRow = {
  deviceId: string; firstSeen: string; lastSeen: string; appVersion: string; coreVersion: string; os: string; arch: string
  accountId: string | null; username: string | null; accountHint: string; lastIp: string; lastStatus: TelemetryStatus
  lastErrorCode: string | null; lastStartAt: string | null; eventsCount: number; logBytes: number | string
}

export type EventRow = {
  id: string; eventId: string; sessionId: string; seq: number; ts: string; type: string; status: TelemetryStatus
  durationMs: number | null; errorCode: string | null; errorText: string | null; appVersion: string; payload: Record<string, unknown>
}

export type LogChunkRow = {
  id: string; sessionId: string; startedAt: string; endedAt: string; lineCount: number; bytes: number
  text?: string; matches?: string[]
}

/** 事件类型中文名（目录见 docs/telemetry-events.md；未知类型显示原值）。 */
export const EVENT_LABELS: Record<string, string> = {
  'app.start': '软件启动', 'app.exit': '软件退出', 'app.crash': '崩溃', 'app.page_view': '打开页面',
  'app.update_check': '检查更新', 'app.update': '安装更新', 'app.update_result': '更新结果',
  'proxy.start': '启动代理', 'proxy.stop': '停止代理', 'proxy.restart': '重启代理', 'tun.create': '创建虚拟网卡',
  'core.exit': '内核退出', 'core.fatal': '内核致命错误', 'core.update': '内核更新', 'net.blocked': '网络被拦截',
  'node.add': '添加节点', 'node.remove': '删除节点', 'node.select': '选择节点', 'node.latency': '延迟测试',
  'node.tcp': 'TCP 测试', 'node.latency_all': '全部测速', 'node.speed': '测速',
  'sub.add': '添加订阅', 'sub.update': '更新订阅', 'sub.edit': '编辑订阅', 'sub.remove': '删除订阅',
  'app_rule.change': '应用分流变更', 'custom_app.change': '自定义应用', 'rule.change': '规则变更', 'ruleset.change': '规则集开关',
  'line.change': '线路变更', 'settings.change': '设置变更', 'mode.change': '模式变更',
  'diag.self_test': '自检', 'diag.route_test': '路由测试', 'diag.ai_env': 'AI 环境检测', 'diag.ai_env_fix': 'AI 环境修复',
  'account.login': '登录', 'account.logout': '退出登录', 'account.register': '注册', 'account.redeem': '兑换',
  'account.license': '会员状态', 'powervpn.nodes': 'POWER云 线路', 'env.security': '安全软件', 'env.other_vpn': '其他 VPN',
  'env.defender': 'Defender 记录', 'proxy_port.change': '端口代理',
}
export const eventLabel = (t: string) => EVENT_LABELS[t] ?? t
export const eventOptions = (types: readonly string[]) => types.map((value) => ({ value, label: eventLabel(value) }))

/** 失败页 / 时间线可筛的事件类型（与旧后台一致）。 */
export const FAILURE_TYPES = ['proxy.start', 'tun.create', 'core.fatal', 'node.latency', 'sub.update', 'app.update', 'app.crash', 'net.blocked'] as const
export const TIMELINE_TYPES = ['proxy.start', 'tun.create', 'core.exit', 'core.fatal', 'node.latency', 'sub.update', 'app.crash', 'env.security', 'settings.change'] as const

export function statusBadge(s: string, infoLabel = '信息'): { label: string; tone: StatusTone } {
  if (s === 'ok') return { label: '成功', tone: 'success' }
  if (s === 'fail') return { label: '失败', tone: 'danger' }
  return { label: infoLabel, tone: 'neutral' }
}

export const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id)
export const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`)
