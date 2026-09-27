import { describe, expect, it } from 'vitest'
import { billUsage } from '../src/billing.ts'
import type { BillingSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'

/** 官方峰谷口径：工作日 9:00-12:00、14:00-18:00 高峰，法定节假日（2026-09-25 起）整天空闲。 */
const snapshot = (provider: string, model: string): BillingSnapshot => ({
  revision: 3,
  rules: {
    version: 1,
    providers: [{
      provider,
      enabled: true,
      models: [{
        model, enabled: true, multiplier: 1, mode: 'peak',
        peak: { input: 10, cacheHit: 1, output: 20 },
        offPeak: { input: 5, cacheHit: 0.5, output: 10 },
        periods: [{ days: [1, 2, 3, 4, 5], start: 540, end: 720 }, { days: [1, 2, 3, 4, 5], start: 840, end: 1080 }],
      }],
    }],
  },
}) as unknown as BillingSnapshot

const usage = { inputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }

describe('statutory holiday peak and valley across providers', () => {
  it('keeps the weekday peak windows for a third-party DeepSeek model', () => {
    const cost = billUsage(snapshot('fast', 'fast/deepseek-v4-flash'), usage, 'fast', 'fast/deepseek-v4-flash', Date.parse('2026-08-24T10:00:00+08:00'))
    expect(cost.peak).toBe(true)
    expect(cost.costInput).toBe(10)
    expect(cost.billingApplied?.mode).toBe('peak')
  })

  it('charges a third-party DeepSeek model at the valley rate on a statutory holiday', () => {
    const holiday = billUsage(snapshot('fast', 'fast/deepseek-v4-flash'), usage, 'fast', 'fast/deepseek-v4-flash', Date.parse('2026-10-01T10:00:00+08:00'))
    expect(holiday.peak).toBe(false)
    expect(holiday.costInput).toBe(5)
    expect(holiday.billingApplied?.mode).toBe('offPeak')
  })

  it('treats the official DeepSeek provider the same way', () => {
    const holiday = billUsage(snapshot('deepseek-official', 'deepseek-v4-flash'), usage, 'deepseek-official', 'deepseek-v4-flash', Date.parse('2026-10-01T14:00:00+08:00'))
    expect(holiday.peak).toBe(false)
    expect(holiday.costInput).toBe(5)
  })

  it('keeps non-DeepSeek models on their configured schedule', () => {
    const other = billUsage(snapshot('openai', 'gpt-5.6-sol'), usage, 'openai', 'gpt-5.6-sol', Date.parse('2026-10-01T10:00:00+08:00'))
    expect(other.peak).toBe(true)
  })

  it('keeps the previous schedule before the 2026-09-25 effective date', () => {
    const before = billUsage(snapshot('deepseek-official', 'deepseek-v4-flash'), usage, 'deepseek-official', 'deepseek-v4-flash', Date.parse('2026-06-19T10:00:00+08:00'))
    expect(before.peak).toBe(true)
    expect(before.costInput).toBe(10)
    const onEffectiveDate = billUsage(snapshot('deepseek-official', 'deepseek-v4-flash'), usage, 'deepseek-official', 'deepseek-v4-flash', Date.parse('2026-09-25T10:00:00+08:00'))
    expect(onEffectiveDate.peak).toBe(false)
    expect(onEffectiveDate.costInput).toBe(5)
  })
})
