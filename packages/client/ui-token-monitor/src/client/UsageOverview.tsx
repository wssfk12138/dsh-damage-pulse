import { useEffect, useState } from 'react'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DetailKey, DetailTranslate } from './detail-locales.ts'
import type { UsageSummary, UsageSummaryRange } from './types.ts'
import { beijingDateTime } from './detail-model.ts'
import styles from './UsageOverview.module.css'

/** Round overview values without trailing zeros or misleading tiny positive zeros. */
export function overviewNumber(value: number | null | undefined, compact = false): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '—'
  const divisor = compact && value >= 100000000 ? 100000000 : compact && value >= 10000 ? 10000 : 1
  const scaled = value / divisor
  return (scaled > 0 && scaled < 0.01 ? '<0.01' : scaled.toLocaleString('zh-CN', { maximumFractionDigits: 2 }))
    + (divisor === 100000000 ? '亿' : divisor === 10000 ? '万' : '')
}

type OverviewRange = UsageSummaryRange | 'custom'

function validSummary(value: unknown, range: UsageSummaryRange): value is UsageSummary {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return row.range === range && ['requestCount', 'totalTokens', 'cacheHitTokens', 'cacheHitRate', 'activeDays']
    .every(key => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0)
    && ['spendCny', 'costPer100mTokensCny', 'activeDaySpendCny'].every(key => row[key] === null || typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0)
}

/** Global ledger overview sharing time/provider filters with the detail list. */
export function UsageOverview({ t, compact, billingInstalled = true, provider = '', providers = [], range, appliedCustom, onProviderChange, onRangeChange }: { t: DetailTranslate; compact: boolean; billingInstalled?: boolean; provider?: string; providers?: readonly string[]; range?: OverviewRange; appliedCustom?: { from: number; to: number } | undefined; onProviderChange?: (provider: string) => void; onRangeChange?: (range: UsageSummaryRange) => void }) {
  const [localRange, setLocalRange] = useState<UsageSummaryRange>('today')
  const selectedRange = range ?? localRange
  const [summary, setSummary] = useState<UsageSummary>()
  const [loading, setLoading] = useState(true), [failed, setFailed] = useState(false)
  const [collapsed, setCollapsed] = useState(false), [revision, setRevision] = useState(0)
  const customFrom = selectedRange === 'custom' ? appliedCustom?.from : undefined
  const customTo = selectedRange === 'custom' ? appliedCustom?.to : undefined
  useEffect(() => {
    // 自定义范围与下方使用记录共用同一毫秒窗口；没有已应用窗口时不请求，避免概览与记录列表不一致。
    const custom = selectedRange === 'custom' && customFrom !== undefined && customTo !== undefined ? { from: customFrom, to: customTo } : undefined
    if (selectedRange === 'custom' && custom === undefined) {
      setLoading(false); setFailed(false); setSummary(undefined)
      return
    }
    const controller = new AbortController()
    setLoading(true); setFailed(false); setSummary(undefined)
    const query = custom === undefined
      ? new URLSearchParams({ range: selectedRange, provider })
      : new URLSearchParams({ range: 'custom', provider, from: String(custom.from), to: String(custom.to) })
    void (async () => {
      try {
        const response = await fetch('/api/token-monitor/usage-summary?' + query, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('Usage summary request failed')
        const result: unknown = await response.json()
        if (!validSummary(result, selectedRange)) throw new Error('Invalid usage summary response')
        if (!controller.signal.aborted) setSummary(result)
      } catch { if (!controller.signal.aborted) setFailed(true) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => { controller.abort() }
  }, [selectedRange, revision, provider, customFrom, customTo])
  const metrics: {
    label: DetailKey
    value: number | null | undefined
    compact?: boolean
    unit?: DetailKey
    prefix?: string
  }[] = [
    { label: 'overviewSpend', value: summary?.spendCny, prefix: '¥', compact: true },
    { label: 'overviewRequests', value: summary?.requestCount, compact: true },
    { label: 'overviewTokens', value: summary?.totalTokens, compact: true },
    { label: 'overviewDays', value: summary?.activeDays, unit: 'overviewDayUnit' },
    { label: 'overviewCache', value: summary?.cacheHitTokens, compact: true },
    { label: 'overviewHitRate', value: summary ? summary.cacheHitRate * 100 : undefined, unit: 'overviewPercent' },
    { label: 'overviewPer100m', value: summary?.costPer100mTokensCny, unit: 'overviewPer100mUnit' },
    { label: 'overviewDaily', value: summary?.activeDaySpendCny, unit: 'overviewDailyUnit' },
  ]
  return <section className={styles.overview} data-compact={compact} aria-label={t('overviewTitle')}>
    <div className={styles.header}>
      <strong>{t('overviewTitle')}</strong>
      <div className={styles.actions}>
        <Button variant="ghost" disabled={loading} onClick={() => { setRevision(value => value + 1) }}>{t('overviewRefresh')}</Button>
        <Button variant="ghost" aria-expanded={!collapsed} onClick={() => { setCollapsed(value => !value) }}>{t(collapsed ? 'overviewExpand' : 'overviewCollapse')}</Button>
      </div>
    </div>
    <div hidden={collapsed}>
      <div className={styles.scope}>
        {onProviderChange && <label className={styles.provider}>{t('provider')} <select aria-label={t('provider')} value={provider} onChange={event => onProviderChange(event.target.value)}><option value="">{t('allProviders')}</option>{providers.map(id => <option key={id} value={id}>{id}</option>)}</select></label>}
        <div className={styles.ranges} role="group" aria-label={t('overviewRange')}>
          {(['all', '30d', '7d', 'yesterday', 'today'] as const).map(value => <Pill key={value} active={selectedRange === value} aria-pressed={selectedRange === value} onClick={() => { onRangeChange?.(value); if (!onRangeChange) setLocalRange(value) }}>{t(value)}</Pill>)}
          {selectedRange === 'custom' && customFrom !== undefined && customTo !== undefined && <span style={{ fontSize: 11, opacity: 0.75 }}>{t('overviewCustom', { from: beijingDateTime(customFrom).replace('T', ' '), to: beijingDateTime(customTo).replace('T', ' ') })}</span>}
        </div>
      </div>
      {failed && <div className={styles.status} role="alert">{t('failed')}</div>}
      {loading && <div className={styles.status} role="status">{t('loading')}</div>}
      <div className={styles.grid} aria-busy={loading}>
        {metrics.filter(metric => billingInstalled || !['overviewSpend', 'overviewPer100m', 'overviewDaily'].includes(metric.label)).map(metric => <div className={styles.card} key={metric.label}
          title={(metric.value == null ? '—' : String(metric.value))}>
          <span>{t(metric.label)}</span>
          <strong>{metric.value == null ? '—' : <>{metric.prefix}{overviewNumber(metric.value, metric.compact)}{metric.unit && <small>{t(metric.unit)}</small>}</>}</strong>
        </div>)}
      </div>
    </div>
  </section>
}
