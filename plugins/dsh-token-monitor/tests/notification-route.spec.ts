import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChargeNotification, NotificationEventBuffer } from '../src/notification-events.ts'
import {
  createNotificationEventsRouteHandler,
  registerNotificationEventsRoute,
  TOKEN_MONITOR_NOTIFICATION_EVENTS_PATH,
} from '../src/notification-route.ts'
import type { UsageRecord } from '../src/types.ts'

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length > 0) await disposers.pop()!()
})

function usage(timestamp: number): UsageRecord {
  return {
    sessionId: 'session-route', turn: 1, step: timestamp, timestamp, provider: 'deepseek', model: 'deepseek-chat',
    inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: 0,
    costInput: 0.001, costCache: 0, costCacheRead: 0, costCacheWrite: 0, costOutput: 0.001,
    cost: 0.002, peak: true,
  }
}

async function serve(buffer: NotificationEventBuffer): Promise<string> {
  const handler = createNotificationEventsRouteHandler(buffer)
  const server: Server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  disposers.push(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  }))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}${TOKEN_MONITOR_NOTIFICATION_EVENTS_PATH}`
}

describe('notification event route', () => {
  it('returns no-store incremental batches with stream identity', async () => {
    const buffer = new NotificationEventBuffer({ streamId: 'boot-route' })
    buffer.publish(createChargeNotification(usage(1), 'normal'))
    buffer.publish(createChargeNotification(usage(2), 'miss'))
    const endpoint = await serve(buffer)

    const response = await fetch(`${endpoint}?since=1`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({
      streamId: 'boot-route',
      seq: 2,
      events: [{ seq: 2, kind: 'charge' }],
    })
  })

  it('supports HEAD without a response body', async () => {
    const endpoint = await serve(new NotificationEventBuffer({ streamId: 'boot-route' }))
    const response = await fetch(endpoint, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('')
  })

  it.each(['-1', '1.5', '01', 'NaN', '9007199254740992'])('rejects invalid since=%s', async (since) => {
    const endpoint = await serve(new NotificationEventBuffer({ streamId: 'boot-route' }))
    const response = await fetch(`${endpoint}?since=${since}`)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'INVALID_SINCE', message: 'since must be a non-negative safe integer' },
    })
  })

  it('rejects unsupported methods with a structured error', async () => {
    const endpoint = await serve(new NotificationEventBuffer({ streamId: 'boot-route' }))
    const response = await fetch(endpoint, { method: 'POST' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
    expect(await response.json()).toMatchObject({ error: { code: 'METHOD_NOT_ALLOWED' } })
  })

  it('exposes an explicit registration seam without registering on import', () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const effects: Array<() => void> = []
    const ctx = { webServer: { register }, effect: (setup: () => () => void) => { effects.push(setup()) } }
    expect(register).not.toHaveBeenCalled()
    registerNotificationEventsRoute(
      ctx as Parameters<typeof registerNotificationEventsRoute>[0],
      new NotificationEventBuffer({ streamId: 'boot-route' }),
    )
    expect(register).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'exact',
      path: TOKEN_MONITOR_NOTIFICATION_EVENTS_PATH,
    }))
    effects.forEach(dispose => dispose())
    expect(dispose).toHaveBeenCalledOnce()
  })
})
