import { useCallback, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PlanQuotaProvider, PlanQuotaSnapshot, PlanQuotaWindow, PlanQuotaWindowKind } from '@deepseek-ai/dsh-token-monitor-contract'
import type { DetailKey, DetailTranslate } from './detail-locales.ts'
import { beijingDateTime } from './detail-model.ts'
import styles from './PlanQuotaPanel.module.css'

/* Host 提供的 Plan 额度快照端点。 */
export const PLAN_QUOTA_URL = '/api/token-monitor/plan-quotas'
/* Plan 额度页签停留期间的轮询间隔。 */
export const PLAN_QUOTA_POLL_MS = 60_000
/* 本地时钟推进间隔，用来保持剩余时长实时。 */
const PLAN_QUOTA_CLOCK_MS = 30_000
/* 额度窗口展示顺序：5h → week → month → other。 */
const windowOrder: Record<PlanQuotaWindowKind, number> = { '5h': 0, week: 1, month: 2, other: 3 }

/* 窗口名按界面语言取词；Host 的 label 仅作为未知周期的回退值。 */
const windowLabelKey: Partial<Record<PlanQuotaWindowKind, DetailKey>> = {
  '5h': 'planQuotaWindow5h',
  week: 'planQuotaWindowWeek',
  month: 'planQuotaWindowMonth',
  other: 'planQuotaWindowOther',
}

/* 一次快照请求的失败类型。 */
export type PlanQuotaError = 'failed' | 'unavailable'
interface PlanQuotaState { data?: PlanQuotaSnapshot; loading: boolean; error?: PlanQuotaError }

function clampPercent(value: number): number { return Math.min(100, Math.max(0, value)) }

/* 读取可选数值字段：null 保持 null，其它非法值直接判定整份载荷不可用。 */
function optionalNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function parseWindow(value: unknown): PlanQuotaWindow | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.kind !== 'string' || !Object.hasOwn(windowOrder, row.kind)) return undefined
  if (typeof row.label !== 'string') return undefined
  const usedPercent = optionalNumber(row.usedPercent)
  const used = optionalNumber(row.used)
  const total = optionalNumber(row.total)
  if (usedPercent === undefined || used === undefined || total === undefined) return undefined
  // 刷新时间字段非法时只丢这一项，不牵连整个供应商。
  const resetAt = typeof row.resetAt === 'number' && Number.isFinite(row.resetAt) ? row.resetAt : undefined
  return { kind: row.kind as PlanQuotaWindowKind, label: row.label, usedPercent, used, total, resetAt }
}

function parseProvider(value: unknown): PlanQuotaProvider | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.provider !== 'string' || typeof row.label !== 'string') return undefined
  if (row.status !== 'ok' && row.status !== 'error') return undefined
  if (typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)) return undefined
  if (!Array.isArray(row.windows)) return undefined
  const windows: PlanQuotaWindow[] = []
  for (const item of row.windows) {
    const window = parseWindow(item)
    if (!window) return undefined
    windows.push(window)
  }
  return {
    provider: row.provider,
    label: row.label,
    plan: typeof row.plan === 'string' ? row.plan : undefined,
    windows,
    updatedAt: row.updatedAt,
    status: row.status,
  }
}

/* 校验整份快照，任何数字进入界面之前先确认结构可信。 */
export function parsePlanQuotaSnapshot(value: unknown): PlanQuotaSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)) return undefined
  if (!Array.isArray(row.providers)) return undefined
  const providers: PlanQuotaProvider[] = []
  for (const item of row.providers) {
    // 单个供应商不合格只丢这一家，与 Host 侧「坏条目跳过、不牵连整体」一致。
    const provider = parseProvider(item)
    if (provider) providers.push(provider)
  }
  return { updatedAt: row.updatedAt, providers }
}

/* 单个窗口的已用比例：优先用供应商给出的百分比，否则回退到用量比例。 */
export function planQuotaPercent(window: PlanQuotaWindow): number | null {
  if (window.usedPercent !== null) return clampPercent(window.usedPercent)
  if (window.used !== null && window.total !== null && window.total > 0) return clampPercent(window.used / window.total * 100)
  return null
}

/* 距离下次刷新的剩余时长，按本地时钟计算。 */
export function planQuotaRemaining(resetAt: number | undefined, now: number, t: DetailTranslate): string {
  if (resetAt === undefined) return '—'
  const diff = resetAt - now
  if (diff <= 0) return t('planQuotaExpired')
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return t('planQuotaRemainingSeconds', { seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('planQuotaRemainingMinutes', { minutes })
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 24) return restMinutes > 0
    ? t('planQuotaRemainingHours', { hours, minutes: restMinutes })
    : t('planQuotaRemainingHoursOnly', { hours })
  return t('planQuotaRemainingDays', { days: Math.floor(hours / 24), hours: hours % 24 })
}

function formatAmount(value: number): string { return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }

/**
 * 面板处于激活状态时轮询 Plan 额度端点。
 * @param active - 当前是否允许向 Host 发起请求。
 * @returns 最新快照及其加载、失败状态。
 */
function usePlanQuotas(active: boolean): PlanQuotaState & { reload: () => void } {
  const [state, setState] = useState<PlanQuotaState>({ loading: false })
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => { setRevision(value => value + 1) }, [])
  useEffect(() => {
    if (!active) return
    let disposed = false
    let sequence = 0
    // 只保留当前在途请求：新请求开始时中止上一个，卸载时中止当前，
    // 避免长驻轮询下 controller 数组只增不减。
    let inFlight: AbortController | undefined
    const load = async () => {
      const id = ++sequence
      inFlight?.abort()
      const controller = new AbortController()
      inFlight = controller
      setState(previous => ({ ...previous, loading: true }))
      try {
        const response = await fetch(PLAN_QUOTA_URL, { cache: 'no-store', signal: controller.signal })
        if (disposed || id !== sequence) return
        if (!response.ok) {
          setState(previous => ({ ...previous, loading: false, error: response.status === 404 ? 'unavailable' : 'failed' }))
          return
        }
        const result: unknown = await response.json()
        if (disposed || id !== sequence) return
        const snapshot = parsePlanQuotaSnapshot(result)
        setState(previous => snapshot
          ? { data: snapshot, loading: false }
          : { ...previous, loading: false, error: 'failed' })
      } catch {
        if (disposed || id !== sequence) return
        setState(previous => ({ ...previous, loading: false, error: 'failed' }))
      }
    }
    // 页面在后台时不轮询：桌面端最小化或切走后请求没有意义，恢复可见时立刻补一次。
    // 与 useUsageRefresh 的全量概览轮询保持同一套可见性口径。
    const visible = (): boolean => document.visibilityState !== 'hidden'
    void load()
    let timer: ReturnType<typeof setInterval> | undefined
    const start = (): void => {
      if (timer === undefined) timer = setInterval(() => { if (visible()) void load() }, PLAN_QUOTA_POLL_MS)
    }
    const stop = (): void => { if (timer !== undefined) { clearInterval(timer); timer = undefined } }
    const onVisibility = (): void => {
      if (visible()) { void load(); start() } else stop()
    }
    if (visible()) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      inFlight?.abort()
    }
  }, [active, revision])
  return { ...state, reload }
}

interface WindowRowProps {
  window: PlanQuotaWindow
  now: number
  t: DetailTranslate
}

/* 单个额度窗口：窗口名、已用进度、用量文本、下次刷新时间与剩余时长。 */
function QuotaWindow({ window, now, t }: WindowRowProps) {
  const percent = planQuotaPercent(window)
  const usage = window.used !== null && window.total !== null
    ? t('planQuotaUsed', { used: formatAmount(window.used), total: formatAmount(window.total) })
    : undefined
  const reset = window.resetAt === undefined ? t('planQuotaResetUnknown') : beijingDateTime(window.resetAt).replace('T', ' ')
  // 进度条与百分比都按「剩余额度」表述（契合越用越少的计量直觉）：
  // 满条=充足，空条=用尽；剩余 <10% 红色告警、<30% 黄色提醒。
  // 用量文本保留「已用 X / Y」的绝对量，便于对账。
  const remaining = percent === null ? null : 100 - percent
  const level = remaining === null ? 'unknown' : remaining <= 10 ? 'high' : remaining <= 30 ? 'warn' : 'normal'
  // 已用满时以红字「已耗尽」取代整个数值区，不再展示 100/100 这类读数。
  const exhausted = percent === 100
  // 刷新时间已过但供应商仍报 100%：说明上游还没换窗口，不能同时说「已耗尽」
  // 和「已到期」。这时只提示等待刷新；其它过期场景仍按「已到期」显示。
  const expired = window.resetAt !== undefined && window.resetAt <= now
  const awaitingReset = expired && percent === 100
  // 窗口名按周期走界面语言；Host 的 label 仅作为未知周期的回退值。
  const name = windowLabelKey[window.kind] === undefined ? window.label : t(windowLabelKey[window.kind]!)
  return <div className={styles.window}>
    <div className={styles.windowHead}>
      <span className={styles.windowLabel}>{name}</span>
      {exhausted
        ? <span className={styles.windowExhausted} role="status">{t(awaitingReset ? 'planQuotaAwaitingReset' : 'planQuotaExhausted')}</span>
        : <span className={styles.windowValues}>
          {usage && <span className={styles.windowUsage}>{usage}</span>}
          <span className={styles.windowPercent}>{remaining === null ? t('unknown') : t('planQuotaRemainingPercent', { value: remaining.toFixed(1) })}</span>
        </span>}
    </div>
    <div className={styles.bar} role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={remaining === null ? undefined : Math.round(remaining)}
      aria-valuetext={remaining === null ? t('unknown') : exhausted ? t('planQuotaExhausted') : undefined}>
      <div className={styles.barFill} data-level={level} style={{ width: remaining === null ? '0%' : remaining + '%' }} />
    </div>
    <div className={styles.meta}>
      <span className={styles.metaLabel}>{t('planQuotaResetLabel')}</span>
      <span className={styles.resetTime}>{reset}</span>
      <span className={styles.remaining}>{awaitingReset ? t('planQuotaResetDue') : planQuotaRemaining(window.resetAt, now, t)}</span>
    </div>
  </div>
}

interface ProviderCardProps {
  provider: PlanQuotaProvider
  now: number
  t: DetailTranslate
}

/* 单个供应商区块：展示名、provider 标识、套餐等级及其额度窗口。 */
function ProviderCard({ provider, now, t }: ProviderCardProps) {
  const windows = [...provider.windows].sort((left, right) => windowOrder[left.kind] - windowOrder[right.kind])
  return <section className={styles.provider}>
    <div className={styles.providerHead}>
      <strong className={styles.providerName}>{provider.label}</strong>
      <span className={styles.providerMeta}>
        <span className={styles.providerId}>{provider.provider}</span>
        {provider.plan && <span className={styles.providerPlan}>{t('planQuotaPlan', { plan: provider.plan })}</span>}
      </span>
    </div>
    {provider.status === 'error'
      ? <div className={styles.providerError} role="alert">{t('planQuotaProviderFailed')}</div>
      : windows.length === 0
        ? <div className={styles.providerEmpty}>{t('planQuotaNoWindows')}</div>
        : <div className={styles.windows}>{windows.map(window => <QuotaWindow key={window.kind} window={window} now={now} t={t} />)}</div>}
  </section>
}

interface PlanQuotaPanelProps {
  t: DetailTranslate
  /** 面板当前是否可以向 Host 发起请求并保持轮询。 */
  active: boolean
}

/* 各供应商 Plan 额度：展示每个窗口的下次刷新时间与剩余时长。 */
export function PlanQuotaPanel({ t, active }: PlanQuotaPanelProps) {
  const { data, loading, error, reload } = usePlanQuotas(active)
  const [now, setNow] = useState(() => Date.now())
  // 剩余时长由本地时钟推进，每 30 秒重算一次，组件卸载时清理定时器。
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, PLAN_QUOTA_CLOCK_MS)
    return () => { clearInterval(timer) }
  }, [])
  return <div className={styles.panel} aria-label={t('planQuotaTitle')}>
    {error && <div className={styles.error} role="alert">
      <span>{t(error === 'unavailable' ? 'planQuotaUnavailable' : 'planQuotaFailed')}</span>
      <Button variant="ghost" onClick={reload}>{t('planQuotaRetry')}</Button>
    </div>}
    {loading && !data && <div className={styles.status} role="status">{t('loading')}</div>}
    {data && data.providers.length === 0 && !error && <div className={styles.status}>{t('planQuotaEmpty')}</div>}
    {data && data.providers.length > 0 && <div className={styles.providers}>
      {data.providers.map(provider => <ProviderCard key={provider.provider} provider={provider} now={now} t={t} />)}
    </div>}
    {data && <div className={styles.updated}>{t('planQuotaUpdatedAt', { time: beijingDateTime(data.updatedAt).replace('T', ' ') })}</div>}
  </div>
}
