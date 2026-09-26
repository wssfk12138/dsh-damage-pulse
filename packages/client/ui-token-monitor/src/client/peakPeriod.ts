/** 工作日高峰时段（北京时间，半开区间 [start, end)）。 */
export const PEAK_HOURS: Array<[number, number]> = [[9, 12], [14, 18]]

/**
 * 判断时间戳是否处于北京时间高峰；周末全天返回低谷。
 * @param ts - Epoch timestamp in milliseconds.
 * @param peakHours - Beijing-time weekday hour ranges treated as peak periods.
 * @returns True during a configured weekday peak range.
 */
export function isPeakPeriod(ts: number, peakHours: Array<[number, number]> = PEAK_HOURS): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(ts))
  const weekday = parts.find(part => part.type === 'weekday')?.value
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? -1)
  return peakHours.some(([start, end]) => hour >= start && hour < end)
}
