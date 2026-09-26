import { describe, expect, it } from 'vitest'
import {
  CHINA_STATUTORY_HOLIDAYS,
  OFFICIAL_PROVIDER_ID,
  PRICE_TABLE,
  beijingDate,
  isPeakHour,
  isStatutoryHoliday,
  priceUsage,
} from '../src/pricing.ts'

/** 北京时间某天某点的时间戳。 */
const beijing = (year: number, month: number, day: number, hour: number) => Date.UTC(year, month - 1, day, hour - 8)

describe('Chinese statutory holiday valley pricing', () => {
  it('keeps the configured windows on ordinary weekdays', () => {
    expect(isPeakHour(beijing(2026, 8, 24, 8), PRICE_TABLE.peakHours)).toBe(false)
    expect(isPeakHour(beijing(2026, 8, 24, 9), PRICE_TABLE.peakHours)).toBe(true)
    expect(isPeakHour(beijing(2026, 8, 24, 12), PRICE_TABLE.peakHours)).toBe(false)
    expect(isPeakHour(beijing(2026, 8, 24, 14), PRICE_TABLE.peakHours)).toBe(true)
    expect(isPeakHour(beijing(2026, 8, 24, 18), PRICE_TABLE.peakHours)).toBe(false)
  })

  it('closes the weekday windows on statutory holidays', () => {
    // 2026-10-01 国庆（周四）与 2026-05-04（周一）都在高峰窗口内，但整天算空闲时段。
    expect(isPeakHour(beijing(2026, 10, 1, 10), PRICE_TABLE.peakHours)).toBe(false)
    expect(isPeakHour(beijing(2026, 10, 1, 14), PRICE_TABLE.peakHours)).toBe(false)
    expect(isPeakHour(beijing(2026, 5, 4, 10), PRICE_TABLE.peakHours)).toBe(false)
    expect(isPeakHour(beijing(2026, 5, 4, 14), PRICE_TABLE.peakHours)).toBe(false)
    expect(beijingDate(beijing(2026, 10, 1, 10))).toBe('2026-10-01')
    expect(isStatutoryHoliday(beijing(2026, 10, 1, 10))).toBe(true)
    expect(isStatutoryHoliday(beijing(2026, 8, 24, 10))).toBe(false)
  })

  it('treats a make-up work weekend as the weekend rule', () => {
    // 2026-09-20 是调休上班日，官方口径仍属「周一至周五之外」，整天空闲。
    expect(isPeakHour(beijing(2026, 9, 20, 10), PRICE_TABLE.peakHours)).toBe(false)
  })

  it('charges holiday usage at the valley rate and weekday usage at the peak rate', () => {
    const holiday = priceUsage(1_000_000, 0, 0, 0, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', beijing(2026, 10, 1, 10))
    expect(holiday?.peak).toBe(false)
    expect(holiday?.costInput).toBe(1)
    // 2026-09-28（周一）在 Flash 调价之后且不在节假日表里，按高峰价 2 元/百万输入。
    const workday = priceUsage(1_000_000, 0, 0, 0, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', beijing(2026, 9, 28, 10))
    expect(workday?.peak).toBe(true)
    expect(workday?.costInput).toBe(2)
  })

  it('falls back to the weekend rule for years without a published calendar', () => {
    expect(isPeakHour(beijing(2027, 5, 3, 10), PRICE_TABLE.peakHours, new Set())).toBe(true)
    expect(isStatutoryHoliday(beijing(2027, 5, 3, 10))).toBe(false)
    expect(CHINA_STATUTORY_HOLIDAYS.size).toBe(33)
  })
})

