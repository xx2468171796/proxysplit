// 套餐目录接口（GET /v1/catalog/plans，免登录）里随套餐一起给的两样东西：
// 免费版能用几台设备、现在实际用什么付款。官网和客户端的文案都读它，不各自写死。
import type { PaymentProviderRecord } from './store.js'

export type PaymentMethod = 'alipay' | 'wechat'
const METHODS: readonly PaymentMethod[] = ['alipay', 'wechat']

/** 免费版设备数 = 运营设置 defaultDeviceLimit（和 entitlement.effective 同一个算法）。 */
export function freeDevicesOf(settings: { defaultDeviceLimit: number }): number {
  return Math.max(0, Math.floor(Number(settings.defaultDeviceLimit) || 0))
}

/**
 * 实际付款方式，按「当前收款通道」算：
 * 1. 通道 config.methods 写了就用它（'wechat' / 'alipay' / 'wechat,alipay'），中心换通道时在后台改这一项；
 * 2. 统一支付中心（adapter=center）由中心决定通道，目前是微信；
 * 3. 其余（直连支付网关）用运营设置里的 paymentMethods。
 * 通道不存在 / 停用时同样落到第 3 条。
 */
export function paymentMethodsOf(
  provider: Pick<PaymentProviderRecord, 'adapter' | 'config' | 'enabled'> | null,
  settingMethods: readonly string[],
): PaymentMethod[] {
  const pick = (list: readonly string[]) => METHODS.filter(m => list.includes(m))
  if (provider?.enabled) {
    const configured = pick(String(provider.config?.methods ?? '').split(',').map(s => s.trim().toLowerCase()))
    if (configured.length) return configured
    if (provider.adapter === 'center') return ['wechat']
  }
  const fromSettings = pick(settingMethods)
  return fromSettings.length ? fromSettings : ['alipay']
}
