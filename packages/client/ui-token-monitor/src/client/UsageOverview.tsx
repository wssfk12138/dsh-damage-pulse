import { useState } from 'react'
import { Button, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DetailKey, DetailTranslate } from './detail-locales.ts'
import type { UsageSummary, UsageSummaryRange } from './types.ts'
import { beijingDateTime } from './detail-model.ts'
import styles from './UsageOverview.module.css'
import { useUsageRefresh, usageSummaryUrl, type UsageRefreshState } from './useUsageRefresh.ts'

/** Round overview values without trailing zeros or misleading tiny positive zeros. */
export function overviewNumber(value: number | null | undefined, compact = false): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '—'
  const divisor = compact && value >= 100000000 ? 100000000 : compact && value >= 10000 ? 10000 : 1
  const scaled = value / divisor
  return (scaled > 0 && scaled < 0.01 ? '<0.01' : scaled.toLocaleString('zh-CN', { maximumFractionDigits: 2 }))
    + (divisor === 100000000 ? '亿' : divisor === 10000 ? '万' : '')
}

type OverviewRange = UsageSummaryRange | 'custom'

interface OverviewProps {
  t: DetailTranslate
  compact: boolean
  billingInstalled?: boolean
  provider?: string
  providers?: readonly string[]
  range?: OverviewRange
  appliedCustom?: { from: number; to: number } | undefined
  onProviderChange?: (provider: string) => void
  onRangeChange?: (range: UsageSummaryRange) => void
  /** Managed windows provide their sole coordinator; standalone callers need no new props. */
  refresh?: { state: UsageRefreshState<UsageSummary>; onRefresh: () => void }
}

/** Global ledger overview sharing time/provider filters with the detail list. */
export function UsageOverview(props: OverviewProps) {
  const [localRange, setLocalRange] = useState<UsageSummaryRange>('today')
  const shared = { ...props, range: props.range ?? localRange, onRangeChange: props.onRangeChange ?? setLocalRange }
  return props.refresh ? <OverviewContent {...shared} refresh={props.refresh} /> : <StandaloneOverview {...shared} />
}

function StandaloneOverview(props: OverviewProps) {
  const [revision, setRevision] = useState(0)
  const state = useUsageRefresh(usageSummaryUrl(props.range ?? 'today', props.provider ?? '', props.appliedCustom), undefined, false, revision)
  return <OverviewContent {...props} refresh={{ state: state.summary, onRefresh: () => { setRevision(value => value + 1) } }} />
}

function OverviewContent({ t, compact, billingInstalled = true, provider = '', providers = [], range = 'today', appliedCustom, onProviderChange, onRangeChange, refresh }: OverviewProps & { refresh: NonNullable<OverviewProps['refresh']> }) {
  const selectedRange = range
  const { data: summary, loading, error } = refresh.state
  const [collapsed, setCollapsed] = useState(false)
  const customFrom = selectedRange === 'custom' ? appliedCustom?.from : undefined
  const customTo = selectedRange === 'custom' ? appliedCustom?.to : undefined
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
        <Button variant="ghost" onClick={refresh.onRefresh}>{t('overviewRefresh')}</Button>
        <Button variant="ghost" aria-expanded={!collapsed} onClick={() => { setCollapsed(value => !value) }}>{t(collapsed ? 'overviewExpand' : 'overviewCollapse')}</Button>
      </div>
    </div>
    <div hidden={collapsed}>
      <div className={styles.scope}>
        {onProviderChange && <label className={styles.provider}>{t('provider')} <select aria-label={t('provider')} value={provider} onChange={event => onProviderChange(event.target.value)}><option value="">{t('allProviders')}</option>{providers.map(id => <option key={id} value={id}>{id}</option>)}</select></label>}
        <div className={styles.ranges} role="group" aria-label={t('overviewRange')}>
          {(['all', '30d', '7d', 'yesterday', 'today'] as const).map(value => <Pill key={value} active={selectedRange === value} aria-pressed={selectedRange === value} onClick={() => { onRangeChange?.(value) }}>{t(value)}</Pill>)}
          {selectedRange === 'custom' && customFrom !== undefined && customTo !== undefined && <span style={{ fontSize: 11, opacity: 0.75 }}>{t('overviewCustom', { from: beijingDateTime(customFrom).replace('T', ' '), to: beijingDateTime(customTo).replace('T', ' ') })}</span>}
        </div>
      </div>
      {error && <div className={styles.status} role="alert">{t(error)}{summary && ' · ' + t('staleData')}</div>}
      {loading && !summary && <div className={styles.status} role="status">{t('loading')}</div>}
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
