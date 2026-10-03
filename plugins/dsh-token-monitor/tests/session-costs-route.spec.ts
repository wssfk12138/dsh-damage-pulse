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
    writeHead(this: { status: number }, status: number) { this.status = status; return this },
    end(this: { body: string }, value?: string) { this.body = value ?? ''; return this },
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
  it('F2/F3 aggregates original nested spend once, including a grandchild-only root', () => {
    const sessions = new Map([
      ['root', { id: 'root', title: 'Root', project: 'one', child: false }],
      ['child', { id: 'child', title: 'Child', project: 'one', child: true, parent: 'root' }],
      ['grandchild', { id: 'grandchild', title: 'Grandchild', project: 'one', child: true, parent: 'child' }],
    ])
    const source = [summary({ sessionId: 'root', cost: 1 }), summary({ sessionId: 'child', cost: 2 }), summary({ sessionId: 'grandchild', cost: 3 })]
    const before = structuredClone(source)
    const rows = summarizeLedgerSessions(source, sessions)
    expect(Object.fromEntries(rows.map(row => [row.id, row.cost]))).toEqual({ root: 6, child: 2, grandchild: 3 })
    expect(source).toEqual(before)
    expect(Object.fromEntries(summarizeLedgerSessions(source, sessions).map(row => [row.id, row.cost]))).toEqual({ root: 6, child: 2, grandchild: 3 })
    const nestedOnly = summarizeLedgerSessions([source[2]!], sessions)
    expect(Object.fromEntries(nestedOnly.map(row => [row.id, row.cost]))).toEqual({ root: 3, grandchild: 3 })
  })

  it('includes nested and child-only spend in the root without replaying inherited history', () => {
    const sessions = new Map([
      ['root', { id: 'root', title: 'Root', project: 'one', child: false }],
      ['child', { id: 'child', title: 'Child', project: 'one', child: true, parent: 'session-root' }],
      ['nested', { id: 'nested', title: 'Nested', project: 'one', child: true, parent: 'child' }],
    ])
    const source = [summary({ sessionId: 'child', cost: 2 }), summary({ sessionId: 'nested', cost: 3 })]
    const rows = summarizeLedgerSessions(source, sessions)
    expect(rows.find(row => row.id === 'root')).toMatchObject({ cost: 5, calls: 2, totalTokens: 4 })
    expect(rows.find(row => row.id === 'child')?.cost).toBe(2)
    expect(rows.find(row => row.id === 'nested')?.cost).toBe(3)
    expect(source).toHaveLength(2)
  })

  it('does not aggregate cyclic or broken child lineage', () => {
    const sessions = new Map([
      ['a', { id: 'a', title: 'A', project: '', child: true, parent: 'b' }],
      ['b', { id: 'b', title: 'B', project: '', child: true, parent: 'a' }],
      ['orphan', { id: 'orphan', title: 'Orphan', project: '', child: true, parent: 'missing' }],
    ])
    const rows = summarizeLedgerSessions([summary({ sessionId: 'a', cost: 2 }), summary({ sessionId: 'orphan', cost: 3 })], sessions)
    expect(rows.map(row => [row.id, row.cost])).toEqual([['a', 2], ['orphan', 3]])
  })
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

  it('adds persisted child usage to its parent without changing the child row or unrelated sessions', () => {
    const sessions = new Map([
      ['parent', { id: 'parent', title: 'Parent', project: 'one', child: false }],
      ['child', { id: 'child', title: 'Child', project: 'one', child: true, parent: 'session-parent' }],
      ['other-child', { id: 'other-child', title: 'Other', project: 'two', child: true, parent: 'session-parent' }],
    ])
    const source = [
      summary({ sessionId: 'session-parent', cost: 1.2, calls: 2 }),
      summary({ sessionId: 'child', cost: 3.04, calls: 5 }),
      summary({ sessionId: 'other-child', cost: 7, calls: 8 }),
      summary({ sessionId: 'orphan', cost: 0.5, calls: 1 }),
    ]
    const rows = summarizeLedgerSessions(source, sessions)
    expect(rows.find(row => row.id === 'parent')).toEqual(expect.objectContaining({ cost: 4.24, calls: 7 }))
    expect(rows.find(row => row.id === 'child')).toEqual(expect.objectContaining({ cost: 3.04, calls: 5 }))
    expect(rows.find(row => row.id === 'other-child')?.cost).toBe(7)
    expect(rows.find(row => row.id === 'orphan')?.cost).toBe(0.5)
    expect(source[0]?.cost).toBe(1.2)
    expect(summarizeLedgerSessions(source, sessions).find(row => row.id === 'parent')?.cost).toBe(4.24)
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
