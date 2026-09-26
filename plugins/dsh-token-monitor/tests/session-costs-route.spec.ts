import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { normalizeSessionId, registerSessionCostsRoute, summarizeLedgerSessions } from '../src/session-costs-route.ts'
import type { SessionSummary } from '../src/types.ts'

function summary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: 'session-a', calls: 1, inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
    outputTokens: 1, totalTokens: 2, cost: 0.5, lastActivity: 1, ...overrides,
  }
}

function response(): ServerResponse & { status: number; body: string } {
  return {
    status: 0,
    body: '',
    writeHead(status: number) { this.status = status; return this },
    end(value?: string) { this.body = value ?? ''; return this },
  } as unknown as ServerResponse & { status: number; body: string }
}

const request = (method = 'GET'): IncomingMessage => ({ method, url: '/api/token-monitor/session-costs', headers: {} }) as unknown as IncomingMessage

function handlerFor(rejection: (() => 401 | 403 | undefined) | undefined, summaries: SessionSummary[]) {
  const registered: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }[] = []
  const ctx = {
    ...(rejection === undefined ? {} : { connection: { requestRejection: rejection } }),
    effect: (factory: () => unknown) => { factory(); return () => {} },
    webServer: { register: (options: never) => { registered.push(options); return () => {} } },
  } as unknown as Context
  registerSessionCostsRoute(ctx, () => summaries)
  return registered[0]!
}

describe('session cost fallback route', () => {
  it('normalizes ids and exposes only sessions that carry spend', () => {
    const rows = summarizeLedgerSessions([
      summary({ sessionId: 'session-a', cost: 0.5, lastActivity: 2 }),
      summary({ sessionId: 'b', cost: 0, lastActivity: 9 }),
      summary({ sessionId: 'session-c', cost: Number.NaN, lastActivity: 9 }),
    ])
    expect(rows).toEqual([expect.objectContaining({ sessionId: 'a', cost: 0.5 })])
    expect(normalizeSessionId('session-abc')).toBe('abc')
    expect(normalizeSessionId('abc')).toBe('abc')
  })

  it('serves the aggregate to an accepted caller and fails closed otherwise', () => {
    const summaries = [summary({ sessionId: 'session-a', cost: 0.25, lastActivity: 2 }), summary({ sessionId: 'b', cost: 1.5, lastActivity: 1 })]
    const accepted = response()
    handlerFor(() => undefined, summaries).handler(request(), accepted)
    expect(accepted.status).toBe(200)
    const body = JSON.parse(accepted.body) as { sessions: SessionSummary[] }
    expect(body.sessions.map(row => [row.sessionId, row.cost])).toEqual([['a', 0.25], ['b', 1.5]])

    const refused = response()
    handlerFor(() => 401, summaries).handler(request(), refused)
    expect(refused.status).toBe(401)
    expect(refused.body).toBe('unauthorized')

    const noConnection = response()
    handlerFor(undefined, summaries).handler(request(), noConnection)
    expect(noConnection.status).toBe(403)
  })
})
