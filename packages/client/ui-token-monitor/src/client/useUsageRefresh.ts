import { useEffect, useRef, useState } from 'react'
import type { DetailPage } from '@deepseek-ai/dsh-token-monitor-contract'
import type { UsageSummary, UsageSummaryRange } from './types.ts'

/** Safe display states; response bodies and credentials never become error copy. */
export type UsageRefreshError = 'failed' | 'authorizationExpired' | 'expired'
export interface UsageRefreshState<T> { data?: T; loading: boolean; error?: UsageRefreshError }
interface UsageState { summary: UsageRefreshState<UsageSummary>; details: UsageRefreshState<DetailPage> }
type Endpoint = keyof UsageState
interface Target { url?: string | undefined; poll: boolean }
interface RequestSlot { target: Target; generation: number; controller?: AbortController | undefined; failures: number }
const endpoints: Endpoint[] = ['summary', 'details']
const emptyState = (): UsageState => ({ summary: { loading: false }, details: { loading: false } })

/** Shared scope excludes detail-only model, conversation, project and error filters. */
export function usageSummaryUrl(range: UsageSummaryRange, provider: string, custom?: { from: number; to: number }): string | undefined {
  if (range === 'custom' && !custom) return undefined
  const query = new URLSearchParams({ range, provider })
  if (range === 'custom' && custom) { query.set('from', String(custom.from)); query.set('to', String(custom.to)) }
  return '/api/token-monitor/usage-summary?' + query
}

function validResponse(endpoint: Endpoint, value: unknown, url: string): boolean {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  if (endpoint === 'details') return Array.isArray(row.rows) && Array.isArray(row.sessions) && Array.isArray(row.models)
    && Number.isSafeInteger(row.pages) && typeof row.snapshot === 'string'
  const range = new URL(url, 'http://localhost').searchParams.get('range')
  return row.range === range && ['requestCount', 'totalTokens', 'cacheHitTokens', 'cacheHitRate', 'activeDays']
    .every(key => typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0)
    && ['spendCny', 'costPer100mTokensCny', 'activeDaySpendCny'].every(key => row[key] === null || typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] >= 0)
}

/** One timer per window; each endpoint owns at most one effective generation. */
class UsageRefreshCoordinator {
  private state = emptyState()
  private slots: Record<Endpoint, RequestSlot> = {
    summary: { target: { poll: true }, generation: 0, failures: 0 },
    details: { target: { poll: true }, generation: 0, failures: 0 },
  }
  private timer: ReturnType<typeof setTimeout> | undefined
  private publish: ((state: UsageState) => void) | undefined
  private blocked = false
  private revision: number | undefined
  private visible = false

  start(publish: (state: UsageState) => void) { this.publish = publish; this.visible = document.visibilityState !== 'hidden' }
  stop() {
    this.publish = undefined
    this.clearTimer()
    for (const endpoint of endpoints) { this.cancel(endpoint); this.slots[endpoint].target = { poll: true } }
    this.revision = undefined
  }
  private emit() { this.publish?.({ ...this.state }) }
  private status(endpoint: Endpoint, patch: { loading?: boolean; error?: UsageRefreshError }) {
    if (endpoint === 'summary') this.state.summary = { ...this.state.summary, ...patch }
    else this.state.details = { ...this.state.details, ...patch }
  }
  private clearTimer() { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined }
  private cancel(endpoint: Endpoint) {
    const slot = this.slots[endpoint]
    slot.generation++
    slot.controller?.abort()
    slot.controller = undefined
    this.status(endpoint, { loading: false })
  }
  configure(summaryUrl: string | undefined, detailsUrl: string | undefined, history: boolean, revision: number) {
    const manual = this.revision !== undefined && this.revision !== revision
    this.revision = revision
    if (manual) this.blocked = false
    this.clearTimer()
    for (const endpoint of endpoints) {
      const slot = this.slots[endpoint]
      const url = endpoint === 'summary' ? summaryUrl : detailsUrl
      const changed = slot.target.url !== url
      slot.target = { url, poll: endpoint === 'summary' || !history }
      if (changed || manual) {
        this.cancel(endpoint)
        slot.failures = 0
        // Old data must not impersonate a different filter/page. Same-scope refresh keeps it.
        if (changed) this.state[endpoint] = { loading: false }
        if (url && this.visible && !this.blocked) void this.request(endpoint)
      }
    }
    this.emit()
    this.schedule()
  }
  visibilityChanged() {
    this.visible = document.visibilityState !== 'hidden'
    this.clearTimer()
    if (!this.visible) { for (const endpoint of endpoints) this.cancel(endpoint); this.emit(); return }
    if (this.blocked) return
    for (const endpoint of endpoints) {
      const slot = this.slots[endpoint]
      if (slot.target.poll || !this.state[endpoint].data) void this.request(endpoint)
    }
    this.schedule()
  }
  private schedule() {
    if (!this.publish || !this.visible || this.blocked || this.timer !== undefined || endpoints.some(endpoint => this.slots[endpoint].controller)) return
    if (!endpoints.some(endpoint => this.slots[endpoint].target.poll && this.slots[endpoint].target.url)) return
    const failures = Math.max(...endpoints.map(endpoint => this.slots[endpoint].target.poll ? this.slots[endpoint].failures : 0))
    const delay = Math.min(30000, 2000 * 2 ** Math.max(0, failures - 1))
    this.timer = setTimeout(() => {
      this.timer = undefined
      for (const endpoint of endpoints) if (this.slots[endpoint].target.poll) void this.request(endpoint)
    }, delay)
  }
  private async request(endpoint: Endpoint) {
    const slot = this.slots[endpoint], url = slot.target.url
    if (!this.publish || !this.visible || this.blocked || slot.controller || !url) return
    const generation = ++slot.generation, controller = new AbortController()
    slot.controller = controller
    const current = () => !!this.publish && !controller.signal.aborted && generation === slot.generation
    this.status(endpoint, { loading: true })
    this.emit()
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
      if (!current()) return
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.blocked = true
          this.clearTimer()
          for (const key of endpoints) { this.cancel(key); this.status(key, { error: 'authorizationExpired' }) }
          this.emit()
          return
        }
        this.status(endpoint, { error: response.status === 409 ? 'expired' : 'failed' })
        slot.failures++
        return
      }
      const result: unknown = await response.json()
      if (!current()) return
      if (!validResponse(endpoint, result, url)) throw new Error('Invalid usage response')
      if (endpoint === 'summary') this.state.summary = { data: result as UsageSummary, loading: false }
      else this.state.details = { data: result as DetailPage, loading: false }
      slot.failures = 0
    } catch {
      if (current()) { this.status(endpoint, { error: 'failed' }); slot.failures++ }
    } finally {
      if (current()) { slot.controller = undefined; this.status(endpoint, { loading: false }); this.emit(); this.schedule() }
    }
  }
}

/** React cleanup and stale-response guard: https://react.dev/reference/react/useEffect#fetching-data-with-effects */
export function useUsageRefresh(summaryUrl: string | undefined, detailsUrl?: string, history = false, revision = 0): UsageState {
  const [state, setState] = useState(emptyState)
  const ref = useRef<UsageRefreshCoordinator>()
  if (!ref.current) ref.current = new UsageRefreshCoordinator()
  const coordinator = ref.current
  useEffect(() => {
    coordinator.start(setState)
    const visibility = () => { coordinator.visibilityChanged() }
    document.addEventListener('visibilitychange', visibility)
    return () => { document.removeEventListener('visibilitychange', visibility); coordinator.stop() }
  }, [coordinator])
  useEffect(() => { coordinator.configure(summaryUrl, detailsUrl, history, revision) }, [coordinator, summaryUrl, detailsUrl, history, revision])
  return state
}
