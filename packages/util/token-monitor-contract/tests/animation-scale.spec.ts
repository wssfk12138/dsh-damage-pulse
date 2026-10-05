import { describe, expect, it } from 'vitest'
import { DEFAULT_TOKEN_MONITOR_SETTINGS, parseTokenMonitorSettings, parseTokenMonitorSettingsPatchRequest, pickPublicTokenMonitorSettings } from '../src/index.ts'
describe('animation scale contract', () => {
  it('uses 80% for legacy settings while retaining explicit choices', () => {
    const { animationScale: _old, ...legacy } = DEFAULT_TOKEN_MONITOR_SETTINGS
    const parsed = parseTokenMonitorSettings(legacy)
    expect(parsed.ok && parsed.value.animationScale).toBe(0.8)
    expect(pickPublicTokenMonitorSettings(legacy).animationScale).toBe(0.8)
    const custom = parseTokenMonitorSettings({ ...legacy, animationScale: 0.9 })
    expect(custom.ok && custom.value.animationScale).toBe(0.9)
  })
  it.each([0.5, 0.6, 0.8, 1])('accepts proportion %s', value => {
    expect(parseTokenMonitorSettingsPatchRequest({ patch: { animationScale: value } }).ok).toBe(true)
  })
  it.each([0, 0.49, 1.01, NaN, Infinity, null, '80%', '0.8'])('rejects invalid proportion %s', value => {
    expect(parseTokenMonitorSettingsPatchRequest({ patch: { animationScale: value } }).ok).toBe(false)
  })
})
