// 审计动作 / 对象 / 结果的中文词表（审计页筛选、用户详情「日志·审计」共用）。
import type { StatusTone } from '@ankotti/admin-ui'

export const ACTION_LABELS: Record<string, string> = {
  'auth.login': '登录',
  'auth.login.device_limit': '登录·设备已满',
  'auth.device.activate': '设备激活',
  'auth.refresh': '刷新令牌',
  'auth.logout': '登出',
  'user.redeem': '用户兑换',
  'user.device.unbind': '用户解绑设备',
  'user.phone.bind': '绑定手机号',
  'admin.user.create': '创建用户',
  'admin.user.status': '用户状态变更',
  'admin.user.password': '重置密码',
  'admin.user.delete': '删除用户',
  'admin.user.provision_powervpn': '开通 POWER云 用户',
  'admin.license.extend': '续费授权',
  'admin.license.grant': '发放会员',
  'admin.device.unbind': '管理员解绑设备',
  'admin.plan.create': '创建套餐',
  'admin.plan.update': '更新套餐',
  'admin.plan.delete': '删除套餐',
  'admin.settings.commerce': '商业设置',
  'admin.payment-provider.update': '支付渠道更新',
  'admin.payment-provider.activate': '切换收款通道',
  'admin.order.confirm': '手动确认订单',
  'admin.order.refund': '订单退款',
  'admin.redeem.create': '创建兑换码',
  'admin.redeem.status': '兑换码状态',
  'admin.redeem.delete': '删除兑换码',
  'admin.announcement.create': '创建公告',
  'admin.announcement.update': '更新公告',
  'admin.announcement.delete': '删除公告',
  'admin.release.create': '发布版本',
  'admin.release.delete': '删除版本',
}

export const auditActionLabel = (action: string) => ACTION_LABELS[action] ?? action

export const TARGET_TYPES: Record<string, string> = {
  user: '用户', device: '设备', session: '会话', plan: '套餐', order: '订单', 'redeem-code': '兑换码',
  announcement: '公告', release: '版本', 'payment-provider': '支付渠道', settings: '设置',
}
export const targetTypeLabel = (t: string) => TARGET_TYPES[t] ?? t

export const RESULTS: Record<string, { label: string; tone: StatusTone }> = {
  success: { label: '成功', tone: 'success' },
  denied: { label: '拒绝', tone: 'danger' },
  failed: { label: '失败', tone: 'danger' },
  locked: { label: '锁定', tone: 'warning' },
}
export const auditResult = (r: string) => RESULTS[r] ?? { label: r, tone: 'neutral' as const }
