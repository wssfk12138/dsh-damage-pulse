/** Provider-owned reminder state, fed only after ledger acceptance. */
import type { TokenMonitorSettings } from '@deepseek-ai/dsh-token-monitor-contract'
import { createCacheHitAnomalyDetector, formatCacheHitAnomalyMessage, type CacheHitAnomalyDetector } from './cache-hit-anomaly.ts'
import { DailyBudgetThresholdTracker } from './budget.ts'
import { formatBudgetThresholdMessage } from './budget-notify.ts'
import { createBudgetThresholdNotification, createCacheHitAnomalyNotification, type TokenMonitorNotificationDraft } from './notification-events.ts'
import { beijingDateKey } from './todaySpend.ts'
import type { TodaySpendInfo, UsageRecord } from './types.ts'

/** Create isolated budget and cache episodes for concurrent providers.
 * @param history Accepted ledger at startup; used only to seed budget totals.
 * @param settings Current settings for the exact provider id.
 * @param publish Delivery callback, including provider identity.
 * @param now Clock for Beijing-day and future-record checks.
 * @returns Observer for each newly accepted record.
 */
export function createProviderNotificationObserver(
  history: readonly UsageRecord[],
  settings: (provider: string) => TokenMonitorSettings,
  publish: (provider: string, event: TokenMonitorNotificationDraft, message: string) => void,
  now: () => number = Date.now,
): (record: UsageRecord) => void {
  const budgets = new Map<string, { total: TodaySpendInfo; tracker: DailyBudgetThresholdTracker }>()
  const detectors = new Map<string, CacheHitAnomalyDetector>()
  const initialTime = now()
  const initialDate = beijingDateKey(initialTime)
  const initialTotals = new Map<string, number>()
  for (const record of history) {
    if (record.timestamp > initialTime || beijingDateKey(record.timestamp) !== initialDate || (record.billingStatus !== undefined && record.billingStatus !== 'priced')) continue
    initialTotals.set(record.provider, (initialTotals.get(record.provider) ?? 0) + record.cost)
  }
  const budgetFor = (provider: string, timestamp: number) => {
    let state = budgets.get(provider)
    if (!state) {
      const config = settings(provider)
      const total: TodaySpendInfo = { date: initialDate, currency: 'CNY', timeZone: 'Asia/Shanghai', cost: initialTotals.get(provider) ?? 0, calls: 0, updatedAt: timestamp }
      state = { total, tracker: new DailyBudgetThresholdTracker(total, config.dailyBudgetCny, config.dailyBudgetEnabled) }
      budgets.set(provider, state)
    }
    return state
  }
  return record => {
    const timestamp = now()
    if (record.timestamp > timestamp) return
    const config = settings(record.provider)
    const key = JSON.stringify([record.provider, record.model])
    let detector = detectors.get(key)
    if (!detector) {
      detector = createCacheHitAnomalyDetector(() => {
        const current = settings(record.provider)
        return { enabled: current.cacheHitAnomalyNotificationEnabled, thresholdPercent: current.cacheHitAnomalyThreshold, consecutiveCalls: current.cacheHitAnomalyConsecutiveCalls }
      })
      detectors.set(key, detector)
    }
    const anomaly = detector.observe(record)
    if (anomaly) publish(record.provider, createCacheHitAnomalyNotification(anomaly, record), formatCacheHitAnomalyMessage(anomaly))
    if ((record.billingStatus !== undefined && record.billingStatus !== 'priced') || beijingDateKey(record.timestamp) !== beijingDateKey(timestamp)) return
    const state = budgetFor(record.provider, timestamp)
    const date = beijingDateKey(timestamp)
    state.total = { ...state.total, date, cost: (state.total.date === date ? state.total.cost : 0) + record.cost, updatedAt: timestamp }
    const crossing = state.tracker.observe(state.total, config.dailyBudgetCny, config.dailyBudgetEnabled)
    if (crossing && config.budgetExceededNotificationEnabled) publish(record.provider, createBudgetThresholdNotification(crossing, timestamp, record.provider), formatBudgetThresholdMessage(crossing))
  }
}
