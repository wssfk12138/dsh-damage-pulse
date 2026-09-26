import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  indexLedgerSessions, ledgerSessionCost, ledgerSessionEntry, normalizeSessionId, resolveSessionCost,
  type LedgerSessionSummary,
} from '../src/client/sessionLedger.ts'

const row = (overrides: Partial<LedgerSessionSummary>): LedgerSessionSummary => ({
  id: 'session-a', cost: 0.5, calls: 2, inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
  outputTokens: 5, totalTokens: 15, lastActivity: 3, ...overrides,
})

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('session ledger fallback', () => {
  it('normalizes ids and answers both spellings of the same session', () => {
    const map = indexLedgerSessions([row({})])
    expect(normalizeSessionId('session-abc')).toBe('abc')
    expect(ledgerSessionCost(map, 'session-a')).toBe(0.5)
    expect(ledgerSessionCost(map, 'a')).toBe(0.5)
    expect(ledgerSessionCost(map, 'missing')).toBeUndefined()
    expect(ledgerSessionCost(map, undefined)).toBeUndefined()
    const viaSessionId = indexLedgerSessions([row({ id: '', sessionId: 'session-xyz' })])
    expect(ledgerSessionCost(viaSessionId, 'xyz')).toBe(0.5)
    expect(ledgerSessionCost(viaSessionId, 'session-xyz')).toBe(0.5)
  })

  it('ignores rows without spend so the fallback never shows a zero', () => {
    const map = indexLedgerSessions([row({ cost: 0, id: 'zero' }), row({ cost: Number.NaN, id: 'nan' })])
    expect(ledgerSessionEntry(map, 'zero')).toBeUndefined()
    expect(ledgerSessionEntry(map, 'nan')).toBeUndefined()
  })

  it('prefers the larger of the projection fold and the durable ledger', () => {
    expect(resolveSessionCost(undefined, 4.1)).toEqual({ cost: 4.1, fromLedger: true })
    expect(resolveSessionCost(0.37, 4.1)).toEqual({ cost: 4.1, fromLedger: true })
    expect(resolveSessionCost(4.1, 0.37)).toEqual({ cost: 4.1, fromLedger: false })
    expect(resolveSessionCost(0.5, 0.5)).toEqual({ cost: 0.5, fromLedger: false })
    expect(resolveSessionCost(undefined, undefined)).toBeUndefined()
  })

  it('fetches once per window and keeps the last good snapshot when the route fails', async () => {
    const { loadSessionLedger } = await import('../src/client/sessionLedger.ts')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sessions: [row({ id: 'session-a' })] }),
    })) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)
    const first = await loadSessionLedger()
    expect(first.get('a')?.cost).toBe(0.5)
    await loadSessionLedger()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch)
    const afterFailure = await loadSessionLedger({ force: true })
    expect(afterFailure.get('a')?.cost).toBe(0.5)
  })
})
