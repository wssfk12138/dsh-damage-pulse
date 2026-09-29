import type { UsageRecord } from './types.ts'

export type UsageSummaryRange = 'all' | '30d' | '7d' | 'yesterday' | 'today' | 'custom'

/** Inclusive millisecond window shared by the overview and the usage record list. */
export interface UsageSummaryWindow {
  from: number
  to: number
}

export interface UsageSummary {
  range: UsageSummaryRange
  from: string | null
  to: string
  spendCny: number | null
  requestCount: number
  totalTokens: number
  cacheHitTokens: number
  cacheHitRate: number
  activeDays: number
  costPer100mTokensCny: number | null
  activeDaySpendCny: number | null
}

const BEIJING_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function beijingDate(timestamp: number): string | undefined {
  if (!Number.isFinite(timestamp)) return undefined
  const parts = BEIJING_DATE_FORMATTER.formatToParts(timestamp)
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  if (typeof values.year !== 'string' || typeof values.month !== 'string' || typeof values.day !== 'string') return undefined
  return `${values.year}-${values.month}-${values.day}`
}

function beijingToday(timestamp: number): string {
  return beijingDate(timestamp) ?? '1970-01-01'
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const utc = Date.UTC(year, month - 1, day + days)
  const shifted = new Date(utc)
  return `${shifted.getUTCFullYear().toString().padStart(4, '0')}-${(shifted.getUTCMonth() + 1).toString().padStart(2, '0')}-${shifted.getUTCDate().toString().padStart(2, '0')}`
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isValidRecord(record: UsageRecord): boolean {
  return Number.isFinite(record.timestamp)
    && isFiniteNonNegative(record.cost)
    && isFiniteNonNegative(record.inputTokens)
    && isFiniteNonNegative(record.outputTokens)
    && isFiniteNonNegative(record.cacheReadTokens)
    && isFiniteNonNegative(record.cacheWriteTokens)
}

function rangeStart(range: UsageSummaryRange, today: string): string | null {
  if (range === 'all') return null
  if (range === 'today' || range === 'yesterday') return today
  if (range === '7d') return addDays(today, -6)
  return addDays(today, -29)
}

/** A custom range is only aggregatable with finite, ordered, non-negative millisecond bounds. */
function validWindow(window: UsageSummaryWindow | undefined): UsageSummaryWindow | undefined {
  if (window === undefined) return undefined
  return Number.isFinite(window.from) && Number.isFinite(window.to) && window.from >= 0 && window.to >= window.from ? window : undefined
}

/** Aggregate all usage identities; historical prices only contribute to monetary metrics. */
import { isOfficialProvider } from './pricing.ts'

export function summarizeUsage(records: readonly UsageRecord[], range: UsageSummaryRange, now = Date.now(), provider?: string, window?: UsageSummaryWindow): UsageSummary | undefined {
  if (!['all', '30d', '7d', 'yesterday', 'today', 'custom'].includes(range)) return undefined
  // 自定义范围按调用方给出的毫秒边界聚合，与使用记录列表使用同一窗口；边界非法时不可聚合。
  const custom = range === 'custom' ? validWindow(window) : undefined
  if (range === 'custom' && custom === undefined) return undefined
  const to = custom !== undefined ? beijingDate(custom.to) ?? beijingToday(now) : range === 'yesterday' ? addDays(beijingToday(now), -1) : beijingToday(now)
  const from = custom !== undefined ? beijingDate(custom.from) ?? null : rangeStart(range, to)
  const selected = records.filter(record => {
    if (!isValidRecord(record)) return false
    // 官方计费路由的两种 provider id 属同一族：按族过滤，历史 deepseek-official 记录
    // 在账号路由配置下同样计入概览。
    if (provider && record.provider !== provider
      && !(isOfficialProvider(provider) && isOfficialProvider(record.provider))) return false
    if (custom !== undefined) return record.timestamp >= custom.from && record.timestamp <= custom.to
    if (record.timestamp > now) return false
    const date = beijingDate(record.timestamp)
    if (date === undefined) return false
    return (from === null || date >= from) && date <= to
  })
  const priced = selected.filter(record => record.billingStatus === undefined || record.billingStatus === 'priced')
  const spendCny = priced.reduce((sum, record) => sum + record.cost, 0)
  const pricedTokens = priced.reduce((sum, record) => sum + record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens + record.outputTokens, 0)
  const inputTokens = selected.reduce((sum, record) => sum + record.inputTokens, 0)
  const outputTokens = selected.reduce((sum, record) => sum + record.outputTokens, 0)
  const cacheHitTokens = selected.reduce((sum, record) => sum + record.cacheReadTokens, 0)
  const cacheWriteTokens = selected.reduce((sum, record) => sum + record.cacheWriteTokens, 0)
  const activeDays = new Set(selected.map(record => beijingDate(record.timestamp)).filter((date): date is string => date !== undefined)).size
  const totalTokens = inputTokens + cacheHitTokens + cacheWriteTokens + outputTokens
  const roundedSpend = selected.length > 0 && priced.length === 0 ? null : Math.round(spendCny * 1000000) / 1000000
  return {
    range,
    from: selected.length === 0 ? null : from ?? beijingDate(selected.reduce((earliest, record) => Math.min(earliest, record.timestamp), Infinity)) ?? null,
    to,
    spendCny: roundedSpend,
    requestCount: selected.length,
    totalTokens,
    cacheHitTokens,
    cacheHitRate: inputTokens + cacheHitTokens > 0 ? cacheHitTokens / (inputTokens + cacheHitTokens) : 0,
    activeDays,
    costPer100mTokensCny: pricedTokens > 0 && roundedSpend !== null ? roundedSpend / pricedTokens * 100000000 : null,
    activeDaySpendCny: activeDays > 0 && roundedSpend !== null ? roundedSpend / activeDays : null,
  }
}
