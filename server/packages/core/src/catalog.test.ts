import { describe, expect, it } from 'vitest'
import { freeDevicesOf, paymentMethodsOf } from './catalog.js'

const provider = (adapter: string, config: Record<string, string | number | boolean> = {}, enabled = true) => ({ adapter, config, enabled })

describe('套餐目录附带的信息', () => {
  it('免费设备数取运营设置，坏值按 0', () => {
    expect(freeDevicesOf({ defaultDeviceLimit: 1 })).toBe(1)
    expect(freeDevicesOf({ defaultDeviceLimit: 2.9 })).toBe(2)
    expect(freeDevicesOf({ defaultDeviceLimit: -3 })).toBe(0)
    expect(freeDevicesOf({ defaultDeviceLimit: Number.NaN })).toBe(0)
  })

  it('统一支付中心 = 微信；直连网关 = 运营设置里的方式', () => {
    expect(paymentMethodsOf(provider('center'), ['alipay'])).toEqual(['wechat'])
    expect(paymentMethodsOf(provider('zhongzhuan'), ['alipay'])).toEqual(['alipay'])
  })

  it('通道 config.methods 优先，只认已知方式，顺序固定', () => {
    expect(paymentMethodsOf(provider('center', { methods: 'alipay' }), ['alipay'])).toEqual(['alipay'])
    expect(paymentMethodsOf(provider('center', { methods: ' WeChat , alipay ,paypal' }), [])).toEqual(['alipay', 'wechat'])
    expect(paymentMethodsOf(provider('center', { methods: 'paypal' }), ['alipay'])).toEqual(['wechat'])
  })

  it('通道不存在或停用：退回运营设置，设置也空就按支付宝', () => {
    expect(paymentMethodsOf(null, ['alipay'])).toEqual(['alipay'])
    expect(paymentMethodsOf(provider('center', {}, false), ['alipay'])).toEqual(['alipay'])
    expect(paymentMethodsOf(null, [])).toEqual(['alipay'])
  })
})
