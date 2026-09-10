import { describe, expect, it } from 'vitest'
import { FLASH_PRICING_START, OFFICIAL_PROVIDER_ID, PRICE_TABLE, beijingWeekday, isPeakHour, priceUsage, selectPriceTable } from '../src/pricing.ts'

const beijing = (day: number, hour: number, minute = 0) => Date.UTC(2026, 7, day, hour - 8, minute)

describe('DeepSeek weekend valley pricing', () => {
  it('keeps the configured peak windows on weekdays and disables them on weekends', () => {
    expect(isPeakHour(beijing(21, 8, 59), PRICE_TABLE.peakHours)).toBe(false)
    expect(isPeakHour(beijing(21, 9), PRICE_TABLE.peakHours)).toBe(true)
    expect(isPeakHour(beijing(21, 12), PRICE_TABLE.peakHours)).toBe(false)
    expect(isPeakHour(beijing(21, 14), PRICE_TABLE.peakHours)).toBe(true)
    expect(isPeakHour(beijing(21, 18), PRICE_TABLE.peakHours)).toBe(false)
    expect(isPeakHour(beijing(22, 9), PRICE_TABLE.peakHours)).toBe(false)
    expect(isPeakHour(beijing(22, 14), PRICE_TABLE.peakHours)).toBe(false)
    expect(isPeakHour(beijing(23, 9), PRICE_TABLE.peakHours)).toBe(false)
    expect(isPeakHour(beijing(24, 9), PRICE_TABLE.peakHours)).toBe(true)
  })

  it('uses Beijing time when Friday UTC crosses into Saturday', () => {
    expect(beijingWeekday(Date.UTC(2026, 7, 21, 15, 59))).toBe(5)
    expect(beijingWeekday(Date.UTC(2026, 7, 21, 16, 0))).toBe(6)
  })

  it('charges known models at the valley rate all weekend and rejects unknown models', () => {
    const saturday = beijing(22, 10)
    const known = priceUsage(1_000_000, 0, 0, 0, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', saturday)
    const unknown = priceUsage(1_000_000, 0, 0, 0, OFFICIAL_PROVIDER_ID, 'future-deepseek-model', saturday)
    expect(known).toBeDefined()
    if (known === undefined) throw new Error('known official model should be eligible')
    expect(known.peak).toBe(false)
    expect(known.costInput).toBe(1.5)
    expect(unknown).toBeUndefined()
  })

  it('switches Flash and Vision-Exp to the email prices at the exact Beijing boundary', () => {
    const before = FLASH_PRICING_START - 1
    const after = FLASH_PRICING_START
    expect(selectPriceTable(before)).not.toBe(PRICE_TABLE)
    expect(priceUsage(1_000_000, 1_000_000, 1_000_000, 1_000_000, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', before)?.cost).toBe(15.1)
    expect(priceUsage(1_000_000, 1_000_000, 1_000_000, 1_000_000, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash-vision-exp', after)?.cost).toBe(6.02)
    const peak = Date.UTC(2026, 8, 11, 6, 0)
    expect(priceUsage(1_000_000, 1_000_000, 1_000_000, 1_000_000, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', peak)?.cost).toBe(12.04)
  })
})
