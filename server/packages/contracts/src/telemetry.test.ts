// 上报合同：描述性的长文本超长时截断，不让一条超长的 errorText 把整批（最多 2000 条事件）拒掉。
import { describe, expect, it } from 'vitest'
import { TELEMETRY_ERROR_TEXT_MAX, telemetryBatchSchema } from './telemetry.js'

const event = (over: Record<string, unknown> = {}) => ({
  eventId: '11111111-2222-4333-8444-555555555555', sessionId: 's1', seq: 1, ts: '2026-10-27T10:00:00Z', type: 'proxy.start', status: 'fail', ...over,
})
const batch = (over: Record<string, unknown> = {}) => ({ schemaVersion: 1, deviceId: 'a'.repeat(64), appVersion: '1.12.5', events: [event()], ...over })

describe('telemetry batch contract', () => {
  it('超长 errorText 截到上限，同批其它事件照收', () => {
    const long = 'x'.repeat(TELEMETRY_ERROR_TEXT_MAX + 5000)
    const parsed = telemetryBatchSchema.parse(batch({ events: [event({ errorText: long }), event({ eventId: '21111111-2222-4333-8444-555555555555', seq: 2, errorText: 'short' })] }))
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events[0]?.errorText).toHaveLength(TELEMETRY_ERROR_TEXT_MAX)
    expect(parsed.events[1]?.errorText).toBe('short')
  })

  it('设备描述字段（os / coreVersion / arch / accountHint / appVersion）超长同样截断', () => {
    const parsed = telemetryBatchSchema.parse(batch({ os: 'o'.repeat(500), coreVersion: 'c'.repeat(500), arch: 'a'.repeat(50), accountHint: 'h'.repeat(500), appVersion: 'v'.repeat(100) }))
    expect([parsed.os?.length, parsed.coreVersion?.length, parsed.arch?.length, parsed.accountHint?.length, parsed.appVersion.length]).toEqual([160, 120, 20, 120, 40])
  })

  it('结构性字段仍然严格：坏的设备号 / 事件类型 / 错误码整批拒绝', () => {
    expect(telemetryBatchSchema.safeParse(batch({ deviceId: 'xyz' })).success).toBe(false)
    expect(telemetryBatchSchema.safeParse(batch({ events: [event({ type: 'Not A Type' })] })).success).toBe(false)
    expect(telemetryBatchSchema.safeParse(batch({ events: [event({ errorCode: 'lower' })] })).success).toBe(false)
  })
})
