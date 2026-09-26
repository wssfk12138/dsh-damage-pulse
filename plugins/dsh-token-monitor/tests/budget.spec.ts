import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  DailyBudgetThresholdTracker, crossedDailyBudget, dailyBudgetInfo,
} from '../src/budget.ts'
import {
  attachBudgetThresholdNotifications, formatBudgetThresholdMessage,
  type BudgetNotificationContext,
} from '../src/budget-notify.ts'
import { pricingEligibilityInfo, registerBudgetRoutes } from '../src/budget-routes.ts'
import { PRICE_TABLE } from '../src/pricing.ts'
import type { TodaySpendInfo } from '../src/types.ts'

function today(cost: number, date = '2026-08-23'): TodaySpendInfo {
  return { date, timeZone: 'Asia/Shanghai', currency: 'CNY', cost, calls: 1, updatedAt: 1 }
}

describe('daily budget', () => {
  it('keeps an over-budget remainder negative', () => {
    const result = dailyBudgetInfo(today(12.35), 10)
    expect(result).toMatchObject({ budget: 10, spend: 12.35, exceeded: true })
    expect(result.remaining).toBeCloseTo(-2.35)
  })

  it('fires only on a below-to-at-or-above crossing', () => {
    expect(crossedDailyBudget(9.99, 10, 10)).toBe(true)
    expect(crossedDailyBudget(10, 12, 10)).toBe(false)
    expect(crossedDailyBudget(8, 9, 10)).toBe(false)
  })

  it('deduplicates within a day and resets on a new Beijing day', () => {
    const tracker = new DailyBudgetThresholdTracker(today(8), 10)
    expect(tracker.observe(today(10.5))).toMatchObject({ previousSpend: 8, currentSpend: 10.5 })
    expect(tracker.observe(today(12))).toBeUndefined()
    expect(tracker.observe(today(7, '2026-08-24'))).toBeUndefined()
    expect(tracker.observe(today(10, '2026-08-24'))).toMatchObject({ date: '2026-08-24' })
  })

  it('seeds a crossed cold-start snapshot without replaying a notification', () => {
    const tracker = new DailyBudgetThresholdTracker(today(11), 10)
    expect(tracker.observe(today(12))).toBeUndefined()
  })

  it('rebases budget edits before the next real usage crossing', () => {
    const raised = new DailyBudgetThresholdTracker(today(9), 10)
    expect(raised.observe(today(15), 20, true)).toBeUndefined()
    expect(raised.observe(today(20), 20, true)).toMatchObject({
      budget: 20, previousSpend: 15, currentSpend: 20,
    })

    const lowered = new DailyBudgetThresholdTracker(today(15), 20)
    expect(lowered.observe(today(16), 10, true)).toBeUndefined()
    expect(lowered.observe(today(18), 10, true)).toBeUndefined()
  })

  it('tracks spend while disabled and does not replay a disabled crossing', () => {
    const tracker = new DailyBudgetThresholdTracker(today(9), 10)
    expect(tracker.observe(today(11), 10, false)).toBeUndefined()
    expect(tracker.observe(today(12), 10, true)).toBeUndefined()
    expect(tracker.observe(today(15), 15, true)).toMatchObject({
      budget: 15, previousSpend: 12, currentSpend: 15,
    })
  })

  it('formats a non-blocking notification with the negative remainder', () => {
    const message = formatBudgetThresholdMessage({
      date: '2026-08-23', budget: 10, previousSpend: 9, currentSpend: 10.25, remaining: -0.25,
    })
    expect(message).toContain('【dsh-damage-pulse · 今日预算】')
    expect(message).toContain('鲸鱼娘只负责提醒')
    expect(message).toContain('CNY -0.25')
    expect(message).toContain('不会阻止或取消任何请求')
    expect(message).not.toContain('DSH Token Monitor')
    expect(vi.fn()).not.toHaveBeenCalled()
  })

  it('publishes the configured pricing allowlist without client-side model defaults', () => {
    expect(pricingEligibilityInfo(PRICE_TABLE, 123)).toEqual({
      provider: 'deepseek-official',
      models: Object.keys(PRICE_TABLE.models),
      updatedAt: 123,
    })
  })

  it('reads the current budget for every daily-budget request', () => {
    let budget = 10
    let dailyBudgetHandler: ((request: unknown, response: any) => void) | undefined
    const context = {
      effect: (setup: () => unknown) => setup(),
      connection: { requestRejection: () => undefined },
      webServer: {
        register(route: { path: string; handler: (request: unknown, response: any) => void }) {
          if (route.path === '/api/token-monitor/daily-budget') dailyBudgetHandler = route.handler
        },
      },
    } as unknown as Context
    registerBudgetRoutes(context, { todaySpend: () => today(12) }, () => budget, PRICE_TABLE)

    const request = () => {
      let body = ''
      dailyBudgetHandler?.({}, { writeHead: vi.fn(), end: (chunk: string) => { body = chunk } })
      return JSON.parse(body) as { budget: number; remaining: number }
    }
    expect(request()).toMatchObject({ budget: 10, remaining: -2 })
    budget = 20
    expect(request()).toMatchObject({ budget: 20, remaining: 8 })
  })

  it('sends once for a current-day crossing and contains sender failures', async () => {
    const now = Date.parse('2026-08-23T04:00:00.000Z')
    let spend = 9
    let listener: ((session: unknown, event: any) => void) | undefined
    const context: BudgetNotificationContext = {
      on: (_event, callback) => { listener = callback },
    }
    const send = vi.fn().mockResolvedValue({ ok: false, code: 'send-failed', detail: 'offline' })
    const warn = vi.fn()
    attachBudgetThresholdNotifications(
      context,
      { todaySpend: () => today(spend) },
      () => ({ dailyBudgetEnabled: true, dailyBudgetCny: 10, budgetExceededNotificationEnabled: true }),
      { send },
      { now: () => now, warn },
    )

    spend = 10.25
    listener?.({}, { type: 'token-usage/record', data: { record: { timestamp: now - 1_000 } } })
    spend = 12
    listener?.({}, { type: 'token-usage/record', data: { record: { timestamp: now } } })
    await Promise.resolve()

    expect(send).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('不影响计费/UI'))
  })

  it('publishes the crossing before attempting the optional WeChat delivery', async () => {
    const now = Date.parse('2026-08-23T04:00:00.000Z')
    let spend = 9
    let listener: ((session: unknown, event: any) => void) | undefined
    const context: BudgetNotificationContext = {
      on: (_event, callback) => { listener = callback },
    }
    const calls: string[] = []
    const onCrossing = vi.fn(() => calls.push('event'))
    const send = vi.fn(async () => {
      calls.push('wechat')
      return { ok: true as const }
    })
    attachBudgetThresholdNotifications(
      context,
      { todaySpend: () => today(spend) },
      () => ({ dailyBudgetEnabled: true, dailyBudgetCny: 10, budgetExceededNotificationEnabled: true }),
      { send },
      { now: () => now, onCrossing },
    )

    spend = 10.25
    listener?.({}, { type: 'token-usage/record', data: { record: { timestamp: now } } })
    await Promise.resolve()

    expect(onCrossing).toHaveBeenCalledOnce()
    expect(onCrossing).toHaveBeenCalledWith(expect.objectContaining({ currentSpend: 10.25 }), now)
    expect(calls).toEqual(['event', 'wechat'])
  })

  it('ignores old-day and future replay events without invoking the sender', () => {
    const now = Date.parse('2026-08-23T04:00:00.000Z')
    let listener: ((session: unknown, event: any) => void) | undefined
    const context: BudgetNotificationContext = {
      on: (_event, callback) => { listener = callback },
    }
    const send = vi.fn().mockResolvedValue({ ok: true })
    attachBudgetThresholdNotifications(
      context,
      { todaySpend: () => today(11) },
      () => ({ dailyBudgetEnabled: true, dailyBudgetCny: 10, budgetExceededNotificationEnabled: true }),
      { send },
      { now: () => now },
    )

    listener?.({}, { type: 'token-usage/record', data: { record: { timestamp: now - 24 * 60 * 60 * 1_000 } } })
    listener?.({}, { type: 'token-usage/record', data: { record: { timestamp: now + 1 } } })
    expect(send).not.toHaveBeenCalled()
  })

  it('swallows a rejected sender promise after committing the crossing dedupe', async () => {
    const now = Date.parse('2026-08-23T04:00:00.000Z')
    let spend = 9
    let listener: ((session: unknown, event: any) => void) | undefined
    const context: BudgetNotificationContext = {
      on: (_event, callback) => { listener = callback },
    }
    const send = vi.fn().mockRejectedValue(new Error('boom'))
    const warn = vi.fn()
    attachBudgetThresholdNotifications(
      context,
      { todaySpend: () => today(spend) },
      () => ({ dailyBudgetEnabled: true, dailyBudgetCny: 10, budgetExceededNotificationEnabled: true }),
      { send },
      { now: () => now, warn },
    )

    spend = 11
    expect(() => listener?.({}, { type: 'token-usage/record', data: { record: { timestamp: now } } })).not.toThrow()
    listener?.({}, { type: 'token-usage/record', data: { record: { timestamp: now } } })
    await Promise.resolve()

    expect(send).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('预算提醒异常'))
  })

  it('consumes a crossing while the event switch is off and never replays it when re-enabled', async () => {
    let now = Date.parse('2026-08-23T04:00:00.000Z')
    let spend = 9
    let notificationEnabled = false
    let listener: ((session: unknown, event: any) => void) | undefined
    const context: BudgetNotificationContext = {
      on: (_event, callback) => { listener = callback },
    }
    const onCrossing = vi.fn()
    const send = vi.fn().mockResolvedValue({ ok: true })
    attachBudgetThresholdNotifications(
      context,
      { todaySpend: () => today(spend, now < Date.parse('2026-08-24T00:00:00.000Z') ? '2026-08-23' : '2026-08-24') },
      () => ({
        dailyBudgetEnabled: true,
        dailyBudgetCny: 10,
        budgetExceededNotificationEnabled: notificationEnabled,
      }),
      { send },
      { now: () => now, onCrossing },
    )

    spend = 11
    listener?.({}, { type: 'token-usage/record', data: { record: { timestamp: now } } })
    notificationEnabled = true
    spend = 12
    listener?.({}, { type: 'token-usage/record', data: { record: { timestamp: now } } })
    await Promise.resolve()

    expect(onCrossing).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    now = Date.parse('2026-08-24T04:00:00.000Z')
    spend = 5
    listener?.({}, { type: 'token-usage/record', data: { record: { timestamp: now } } })
    spend = 10.5
    listener?.({}, { type: 'token-usage/record', data: { record: { timestamp: now } } })
    await Promise.resolve()

    expect(onCrossing).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledOnce()
  })
})
