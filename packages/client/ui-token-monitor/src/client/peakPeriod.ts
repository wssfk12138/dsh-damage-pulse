/** 工作日高峰时段（北京时间，半开区间 [start, end)）。 */
export const PEAK_HOURS: Array<[number, number]> = [[9, 12], [14, 18]]

/**
 * 中国法定节假日（北京时间日期，YYYY-MM-DD）。
 * 与 plugins/dsh-token-monitor/src/pricing.ts 的 CHINA_STATUTORY_HOLIDAYS 保持一致：
 * 官方口径为「北京时间周一至周五（不含中国法定节假日）9:00-12:00、14:00-18:00 为高峰时段；
 * 其余时段，包括周末及中国法定节假日全天均为空闲时段」。这里只用于余额卡片的峰谷提示。
 */
export const CHINA_STATUTORY_HOLIDAYS: ReadonlySet<string> = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
])

/**
 * 节假日并入空闲时段的生效时刻：官方 2026-09-25 起执行（北京时间当天 00:00），
 * 与 plugins/dsh-token-monitor/src/pricing.ts 的 STATUTORY_HOLIDAY_PRICING_START 保持一致。
 */
export const STATUTORY_HOLIDAY_PRICING_START = Date.UTC(2026, 8, 24, 16, 0, 0)

/** 取北京时间日期（YYYY-MM-DD）；解析失败返回空串。 */
function beijingDate(ts: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ts))
  const pick = (type: string) => parts.find(part => part.type === type)?.value
  const year = pick('year'); const month = pick('month'); const day = pick('day')
  return year === undefined || month === undefined || day === undefined ? '' : `${year}-${month}-${day}`
}

/**
 * 判断时间戳是否处于北京时间高峰；周末与中国法定节假日全天返回低谷。
 * @param ts - Epoch timestamp in milliseconds.
 * @param peakHours - Beijing-time weekday hour ranges treated as peak periods.
 * @param holidays - Beijing-time statutory holiday dates treated as all-day off-peak.
 * @returns True during a configured weekday peak range.
 */
export function isPeakPeriod(
  ts: number,
  peakHours: Array<[number, number]> = PEAK_HOURS,
  holidays: ReadonlySet<string> = CHINA_STATUTORY_HOLIDAYS,
): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(ts))
  const weekday = parts.find(part => part.type === 'weekday')?.value
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const holiday = beijingDate(ts)
  if (ts >= STATUTORY_HOLIDAY_PRICING_START && holiday !== '' && holidays.has(holiday)) return false
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? -1)
  return peakHours.some(([start, end]) => hour >= start && hour < end)
}
