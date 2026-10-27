// 客户端日志：共享类型与小组件（接口见 server/apps/api/src/telemetry-routes.ts）。
import { Badge } from '@/components/ui/badge'

export interface DeviceRow {
  deviceId: string
  firstSeen: string
  lastSeen: string
  appVersion: string
  coreVersion: string
  os: string
  arch: string
  accountId: string | null
  username: string | null
  accountHint: string
  lastIp: string
  lastStatus: 'ok' | 'fail' | 'info'
  lastErrorCode: string | null
  lastStartAt: string | null
  eventsCount: number
  logBytes: number
}

export interface EventRow {
  id: string
  eventId: string
  sessionId: string
  seq: number
  ts: string
  type: string
  status: 'ok' | 'fail' | 'info'
  durationMs: number | null
  errorCode: string | null
  errorText: string | null
  appVersion: string
  payload: Record<string, unknown>
}

export interface LogChunkRow {
  id: string
  sessionId: string
  startedAt: string
  endedAt: string
  lineCount: number
  bytes: number
  text?: string
  matches?: string[]
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

export function StatusBadge({ value }: { value: string }) {
  if (value === 'ok') return <Badge variant="success">成功</Badge>
  if (value === 'fail') return <Badge variant="destructive">失败</Badge>
  return <Badge variant="secondary">信息</Badge>
}

export const shortId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`

export const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`)

export const toIso = (v: string) => {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}
