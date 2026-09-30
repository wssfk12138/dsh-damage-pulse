import { describe, expect, it, vi } from 'vitest'
import {
  createNotificationEventsApi,
  NotificationEventsProtocolError,
  parseNotificationEventsBatch,
} from '../src/client/notificationApi.ts'

const chargeEvent = {
  schemaVersion: 1,
  seq: 1,
  id: 'charge-1',
  dedupeKey: 'charge-1',
  kind: 'charge',
  timestamp: 1_000,
  priority: 'normal',
  payload: {
    cost: 0.25,
    damageKind: 'normal',
    sessionId: 'session-1',
    turn: 2,
    step: 3,
    provider: 'deepseek',
    model: 'deepseek-chat',
  },
} as const

function batch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { streamId: 'stream-1', seq: 1, events: [chargeEvent], ...overrides }
}

describe('notification events client API', () => {
  it('reports a removed module without parsing an empty batch or retrying', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const result = await createNotificationEventsApi(fetcher).poll({ seq: 0 })
    expect(result).toMatchObject({ ok: false, failure: { kind: 'unavailable', status: 204 } })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('performs a no-store GET and returns copied, strictly parsed events', async () => {
    const raw = batch()
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(raw), { status: 200 }))
    const signal = new AbortController().signal
    const result = await createNotificationEventsApi(fetcher).get(0, signal)

    expect(fetcher).toHaveBeenCalledWith('/api/token-monitor/modules/notification-events?since=0', {
      method: 'GET',
      cache: 'no-store',
      signal,
    })
    expect(result).toEqual(raw)
    expect(result).not.toBe(raw)
    expect(result.events[0]).not.toBe(chargeEvent)
  })

  it('accepts all five event kinds and enforces peak direction', () => {
    const events = [
      chargeEvent,
      {
        ...chargeEvent, seq: 2, id: 'budget-1', dedupeKey: 'budget-1', kind: 'budget-threshold',
        priority: 'high', payload: {
          date: '2026-08-24', budget: 10, previousSpend: 9.5, currentSpend: 10.25, remaining: -0.25,
        },
      },
      {
        ...chargeEvent, seq: 3, id: 'peak-1', dedupeKey: 'peak-1', kind: 'peak-enter',
        payload: { from: 'offPeak', to: 'peak', periodKey: '2026-08-24:peak' },
      },
      {
        ...chargeEvent, seq: 4, id: 'peak-2', dedupeKey: 'peak-2', kind: 'peak-exit',
        payload: { from: 'peak', to: 'offPeak', periodKey: '2026-08-24:offPeak' },
      },
      {
        ...chargeEvent, seq: 5, id: 'cache-anomaly-1', dedupeKey: 'cache-anomaly-1', kind: 'cache-hit-anomaly',
        payload: { episodeId: 1, observedRate: 0.12, threshold: 0.3, sampleCount: 3, consecutiveCalls: 3, observedAt: 1_000 },
      },
    ]
    expect(parseNotificationEventsBatch(batch({ seq: 5, events })).events).toHaveLength(5)

    const invalid = { ...events[2], kind: 'peak-exit' }
    expect(() => parseNotificationEventsBatch(batch({ seq: 3, events: [invalid] })))
      .toThrow(NotificationEventsProtocolError)
  })

  it.each([
    ['missing response field', (() => { const { seq: _seq, ...missing } = batch(); return missing })()],
    ['empty streamId', batch({ streamId: '' })],
    ['unsafe batch seq', batch({ seq: Number.MAX_SAFE_INTEGER + 1 })],
    ['missing event field', batch({ events: (() => { const { id: _id, ...missing } = chargeEvent; return [missing] })() })],
    ['unsupported schema', batch({ events: [{ ...chargeEvent, schemaVersion: 2 }] })],
    ['unknown kind', batch({ events: [{ ...chargeEvent, kind: 'refund' }] })],
    ['mismatched idempotency key', batch({ events: [{ ...chargeEvent, dedupeKey: 'different' }] })],
    ['missing payload field', batch({ events: [{ ...chargeEvent, payload: (() => { const { model: _model, ...missing } = chargeEvent.payload; return missing })() }] })],
    ['invalid charge amount', batch({ events: [{ ...chargeEvent, payload: { ...chargeEvent.payload, cost: 0 } }] })],
    ['invalid charge cursor', batch({ events: [{ ...chargeEvent, payload: { ...chargeEvent.payload, turn: -1 } }] })],
    ['invalid budget crossing', batch({ events: [{
      ...chargeEvent, kind: 'budget-threshold', payload: {
        date: '2026-08-24', budget: 10, previousSpend: 10, currentSpend: 11, remaining: -1,
      },
    }] })],
    ['invalid cache anomaly rate', batch({ events: [{
      ...chargeEvent, kind: 'cache-hit-anomaly', payload: { episodeId: 1, observedRate: 1.1, threshold: 0.3, sampleCount: 3, consecutiveCalls: 3, observedAt: 1_000 },
    }] })],
    ['invalid cache anomaly episode', batch({ events: [{
      ...chargeEvent, kind: 'cache-hit-anomaly', payload: { episodeId: 0, observedRate: 0.1, threshold: 0.3, sampleCount: 3, consecutiveCalls: 3, observedAt: 1_000 },
    }] })],
    ['event after batch cursor', batch({ events: [{ ...chargeEvent, seq: 2 }] })],
    ['duplicate event key', batch({ seq: 2, events: [chargeEvent, { ...chargeEvent, seq: 2 }] })],
    ['unordered events', batch({ seq: 2, events: [{ ...chargeEvent, seq: 2 }, chargeEvent] })],
  ])('rejects %s', (_name, value) => {
    expect(() => parseNotificationEventsBatch(value)).toThrow(NotificationEventsProtocolError)
  })

  it('accepts future non-sensitive fields while returning only the known contract', () => {
    const value = batch({ debug: true, events: [{ ...chargeEvent, futureField: { enabled: true }, payload: { ...chargeEvent.payload, note: 'ignored' } }] })
    const parsed = parseNotificationEventsBatch(value)
    expect(parsed).toEqual(batch())
    expect(parsed).not.toHaveProperty('debug')
    expect(parsed.events[0]).not.toHaveProperty('futureField')
  })

  it('refetches from zero when the Host stream changes', async () => {
    const restarted = batch({ streamId: 'stream-2', seq: 0, events: [] })
    const recovered = batch({ streamId: 'stream-2' })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(restarted), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(recovered), { status: 200 }))
    const result = await createNotificationEventsApi(fetcher).poll({ streamId: 'stream-1', seq: 9 })

    expect(result).toMatchObject({ ok: true, streamChanged: true, batch: recovered })
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/token-monitor/modules/notification-events?since=9', {
      method: 'GET', cache: 'no-store',
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/token-monitor/modules/notification-events?since=0', {
      method: 'GET', cache: 'no-store',
    })
  })

  it('does not refetch an unchanged stream or an initial since-zero request', async () => {
    const response = new Response(JSON.stringify(batch()), { status: 200 })
    const sameFetcher = vi.fn().mockResolvedValue(response)
    await expect(createNotificationEventsApi(sameFetcher).poll({ streamId: 'stream-1', seq: 1 }))
      .resolves.toMatchObject({ ok: true, streamChanged: false })
    expect(sameFetcher).toHaveBeenCalledTimes(1)

    const initialFetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(batch()), { status: 200 }))
    await expect(createNotificationEventsApi(initialFetcher).poll({ seq: 0 }))
      .resolves.toMatchObject({ ok: true, streamChanged: false })
    expect(initialFetcher).toHaveBeenCalledTimes(1)
  })

  it('classifies network, HTTP, protocol, and abort failures without rejecting', async () => {
    const network = createNotificationEventsApi(vi.fn().mockRejectedValue(new Error('offline')))
    await expect(network.poll({ seq: 0 })).resolves.toMatchObject({
      ok: false, failure: { kind: 'network', message: 'offline' },
    })

    const http = createNotificationEventsApi(vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    await expect(http.poll({ seq: 0 })).resolves.toMatchObject({
      ok: false, failure: { kind: 'http', status: 503 },
    })

    const protocol = createNotificationEventsApi(vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    await expect(protocol.poll({ seq: 0 })).resolves.toMatchObject({
      ok: false, failure: { kind: 'protocol' },
    })

    const controller = new AbortController()
    controller.abort()
    const abortError = new Error('cancelled')
    abortError.name = 'AbortError'
    const aborted = createNotificationEventsApi(vi.fn().mockRejectedValue(abortError))
    await expect(aborted.poll({ seq: 0 }, controller.signal)).resolves.toMatchObject({
      ok: false, failure: { kind: 'aborted' },
    })
  })

  it('rejects programmer-invalid cursors and invalid JSON on strict requests', async () => {
    const api = createNotificationEventsApi(vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })))
    await expect(api.get(0)).rejects.toBeInstanceOf(NotificationEventsProtocolError)
    await expect(api.get(-1)).rejects.toBeInstanceOf(RangeError)
    await expect(api.poll({ seq: 1 })).rejects.toBeInstanceOf(RangeError)
  })
})
