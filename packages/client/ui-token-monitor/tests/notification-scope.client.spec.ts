import { expect, it } from 'vitest'
import type { TokenMonitorNotificationEvent } from '../src/client/notificationApi.ts'
import { applyNotificationBatch, createNotificationQueueState, notificationMatchesScope } from '../src/client/notificationQueue.ts'

const event = (provider?: string, model?: string): TokenMonitorNotificationEvent => ({
  schemaVersion: 1, seq: 1, id: 'a', dedupeKey: 'a', timestamp: 1, priority: 'high',
  kind: 'cache-hit-anomaly', ...(provider === undefined ? {} : { provider }), ...(model === undefined ? {} : { model }),
  payload: { episodeId: 1, observedRate: 0, threshold: 0.8, sampleCount: 2, consecutiveCalls: 2, observedAt: 1 },
})
it('isolates foreground reminders while keeping legacy notifications official-only', () => {
  const scope = { provider: 'a', model: 'm' }
  expect(notificationMatchesScope(event('a'), scope)).toBe(true)
  expect(notificationMatchesScope(event('a', 'm'), scope)).toBe(true)
  expect(notificationMatchesScope(event('b', 'm'), scope)).toBe(false)
  expect(notificationMatchesScope(event('a', 'other'), scope)).toBe(false)
  expect(notificationMatchesScope(event(), scope)).toBe(false)
  expect(notificationMatchesScope(event(), { provider: 'deepseek-official', model: 'm' })).toBe(true)
  expect(notificationMatchesScope(event('a'), undefined)).toBe(false)
})
it('advances the stream cursor even when every event belongs to a background provider', () => {
  const batch = { streamId: 'host', seq: 1, events: [event('b')].filter(item => notificationMatchesScope(item, { provider: 'a', model: 'm' })) }
  const result = applyNotificationBatch(createNotificationQueueState(), batch, 1)
  expect(result.state.cursor).toEqual({ streamId: 'host', seq: 1 })
  expect(result.state.ready).toEqual([])
})
