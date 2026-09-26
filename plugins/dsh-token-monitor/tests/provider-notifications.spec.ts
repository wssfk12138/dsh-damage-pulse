import { describe, expect, it } from 'vitest'
import { DEFAULT_TOKEN_MONITOR_SETTINGS } from '@deepseek-ai/dsh-token-monitor-contract'
import { createProviderNotificationObserver } from '../src/provider-notifications.ts'
import type { TokenMonitorNotificationDraft } from '../src/notification-events.ts'
import type { UsageRecord } from '../src/types.ts'

const start = Date.parse('2026-09-20T02:00:00Z')
function record(provider: string, cost: number, overrides: Partial<UsageRecord> = {}): UsageRecord {
  return { sessionId: 's1', turn: 1, step: 1, timestamp: start, provider, model: 'm1',
    inputTokens: 90, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, reasoningTokens: 0,
    costInput: cost, costCache: 0, costCacheRead: 0, costCacheWrite: 0, costOutput: 0, cost, peak: false, ...overrides }
}
const config = { ...DEFAULT_TOKEN_MONITOR_SETTINGS, dailyBudgetEnabled: true, dailyBudgetCny: 5,
  budgetExceededNotificationEnabled: true, cacheHitAnomalyNotificationEnabled: false }

describe('provider reminder ownership', () => {
  it('counts interleaved providers independently and emits distinct dedupe identities', () => {
    const events: TokenMonitorNotificationDraft[] = []
    const observe = createProviderNotificationObserver([], () => config, (_, event) => events.push(event), () => start)
    observe(record('a', 3)); observe(record('b', 3))
    expect(events).toHaveLength(0)
    observe(record('a', 2)); observe(record('b', 2)); observe(record('a', 3))
    expect(events.map(event => event.provider)).toEqual(['a', 'b'])
    expect(new Set(events.map(event => event.dedupeKey)).size).toBe(2)
  })

  it('seeds restart totals, ignores unpriced and future amounts, and resets at Beijing midnight', () => {
    let now = start
    const events: TokenMonitorNotificationDraft[] = []
    const observe = createProviderNotificationObserver([record('a', 6)], () => config, (_, event) => events.push(event), () => now)
    observe(record('a', 1))
    observe(record('b', 9, { billingStatus: 'unpriced' }))
    observe(record('b', 9, { timestamp: start + 1 }))
    expect(events).toHaveLength(0)
    observe(record('b', 5))
    now = Date.parse('2026-09-20T16:00:00Z')
    observe(record('a', 10)) // Yesterday's delayed record is not today's spend.
    observe(record('a', 5, { timestamp: now }))
    expect(events.map(event => event.provider)).toEqual(['b', 'a'])
  })

  it('partitions cache episodes by provider and model, with live provider preferences', () => {
    const events: TokenMonitorNotificationDraft[] = []
    const observe = createProviderNotificationObserver([], provider => ({ ...config, dailyBudgetEnabled: false,
      cacheHitAnomalyNotificationEnabled: provider !== 'off', cacheHitAnomalyConsecutiveCalls: 2 }),
    (_, event) => events.push(event), () => start)
    observe(record('a', 0)); observe(record('b', 0)); observe(record('a', 0, { model: 'm2' }))
    expect(events).toHaveLength(0)
    observe(record('a', 0)); observe(record('b', 0)); observe(record('a', 0, { model: 'm2' }))
    observe(record('off', 0)); observe(record('off', 0))
    expect(events.map(event => [event.provider, event.model])).toEqual([['a', 'm1'], ['b', 'm1'], ['a', 'm2']])
    expect(new Set(events.map(event => event.dedupeKey)).size).toBe(3)
  })
})
