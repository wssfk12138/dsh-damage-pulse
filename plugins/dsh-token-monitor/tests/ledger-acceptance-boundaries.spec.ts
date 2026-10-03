import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { summarizeLedgerSessions } from '../src/session-costs-route.ts'
import { UsageStorage } from '../src/storage.ts'
import { beijingDateKey, summarizeTodaySpend } from '../src/todaySpend.ts'
import type { SessionSummary, UsageRecord } from '../src/types.ts'
import type { DetailSession } from '@deepseek-ai/dsh-token-monitor-contract'

const values = (sessionId: string, n: number, lastActivity = n): SessionSummary => ({
  sessionId, calls: n, inputTokens: 11 * n, cacheReadTokens: 13 * n, cacheWriteTokens: 17 * n,
  outputTokens: 19 * n, totalTokens: 60 * n, cost: n, lastActivity,
})
const meta = (id: string, parent?: string, project = 'one'): DetailSession => ({
  id, title: id, project, child: parent !== undefined, ...(parent === undefined ? {} : { parent }),
})
const amounts = (rows: ReturnType<typeof summarizeLedgerSessions>) => Object.fromEntries(rows.map(row => [row.id, row.cost]))

function permutations<T>(rows: T[]): T[][] {
  if (rows.length === 0) return [[]]
  return rows.flatMap((row, index) => permutations(rows.filter((_, other) => other !== index)).map(rest => [row, ...rest]))
}

describe('ledger session acceptance boundaries', () => {
  it('F1 aggregates every numeric field and maximum activity while keeping each child unchanged', () => {
    const sessions = new Map(['root', 'a', 'b', 'c'].map(id => [id, meta(id, id === 'root' ? undefined : 'root')]))
    const source = [values('root', 1, 8), values('a', 2, 31), values('b', 3, 17), values('c', 4, 24)]
    const rows = summarizeLedgerSessions(source, sessions)
    expect(rows.find(row => row.id === 'root')).toEqual({ ...values('root', 10, 31), id: 'root' })
    for (const child of source.slice(1)) expect(rows.find(row => row.id === child.sessionId)).toEqual({ ...child, id: child.sessionId })
    expect(source[0]).toEqual(values('root', 1, 8))
  })

  it('F2 all six input permutations preserve root and raw child fields', () => {
    const sessions = new Map([['root', meta('root')], ['child', meta('child', 'root')], ['grand', meta('grand', 'child')]])
    for (const input of permutations([values('root', 1, 10), values('child', 2, 20), values('grand', 3, 30)])) {
      const rows = summarizeLedgerSessions(input, sessions)
      expect(rows.find(row => row.id === 'root')).toEqual({ ...values('root', 6, 30), id: 'root' })
      expect(rows.find(row => row.id === 'child')).toEqual({ ...values('child', 2, 20), id: 'child' })
      expect(rows.find(row => row.id === 'grand')).toEqual({ ...values('grand', 3, 30), id: 'grand' })
    }
  })

  it('self-parent, two-node cycle and descendant entering a cycle terminate without hiding a legal row or writing the ledger', () => {
    const sessions = new Map([
      ['self', meta('self', 'self')], ['a', meta('a', 'b')], ['b', meta('b', 'a')],
      ['descendant', meta('descendant', 'a')], ['legal', meta('legal')],
    ])
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cycle-ledger-'))
    try {
      const storage = new UsageStorage(() => true, dir)
      for (const [index, id] of ['self', 'a', 'descendant', 'legal'].entries()) storage.add({
        sessionId: id, turn: 1, step: 1, sourceEventSeq: index + 1, timestamp: 1000 + index,
        provider: 'fixture-provider-a', model: 'fixture-model-x', inputTokens: 1, cacheReadTokens: 0,
        cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: 0, costInput: index + 1,
        costCache: 0, costCacheRead: 0, costCacheWrite: 0, costOutput: 0, cost: index + 1, peak: false,
      })
      const ledger = join(dir, 'usage.jsonl')
      const before = readFileSync(ledger)
      for (let repeat = 0; repeat < 3; repeat++) expect(amounts(summarizeLedgerSessions(storage.list(), sessions))).toEqual({ self: 1, a: 2, descendant: 3, legal: 4 })
      expect(readFileSync(ledger)).toEqual(before)
      expect(storage.history()).toHaveLength(4)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('a missing parent becomes a legal root on a later query without caching the orphan result', () => {
    const sessions = new Map([['child', meta('child', 'middle')]])
    const source = [values('child', 3)]
    expect(amounts(summarizeLedgerSessions(source, sessions))).toEqual({ child: 3 })
    sessions.set('middle', meta('middle', 'root'))
    expect(amounts(summarizeLedgerSessions(source, sessions))).toEqual({ child: 3 })
    sessions.set('root', meta('root'))
    expect(amounts(summarizeLedgerSessions(source, sessions))).toEqual({ child: 3, root: 3 })
    expect(source).toEqual([values('child', 3)])
  })

  it('blocks a known cross-project middle ancestor and preserves the existing absent-project edge policy', () => {
    const source = [values('child', 3)]
    const cross = new Map([['child', meta('child', 'middle', 'one')], ['middle', meta('middle', 'root', 'two')], ['root', meta('root', undefined, 'one')]])
    expect(amounts(summarizeLedgerSessions(source, cross))).toEqual({ child: 3 })
    const absent = new Map([['child', meta('child', 'root', '')], ['root', meta('root', undefined, '')]])
    expect(amounts(summarizeLedgerSessions(source, absent))).toEqual({ child: 3, root: 3 })
    const oneAbsent = new Map([['child', meta('child', 'root', '')], ['root', meta('root')]])
    expect(amounts(summarizeLedgerSessions(source, oneAbsent))).toEqual({ child: 3, root: 3 })
  })

  it('normalizes prefixed summary and metadata identities without duplicating valid unique rows', () => {
    const sessions = new Map([['session-child', meta('child', 'session-root')], ['session-root', meta('root')]])
    const rows = summarizeLedgerSessions([values('session-root', 1), values('session-child', 2)], sessions)
    expect(amounts(rows)).toEqual({ root: 3, child: 2 })
    expect(rows.map(row => [row.id, row.sessionId])).toEqual([['root', 'root'], ['child', 'child']])
  })

  it('accepts frozen inputs, emits only finite positive costs and sorts activity ties stably without altering raw token values', () => {
    const source = Object.freeze([
      Object.freeze(values('older', 1, 10)), Object.freeze(values('tie-a', 2, 30)), Object.freeze(values('tie-b', 3, 30)),
      ...[0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map((cost, index) => Object.freeze({ ...values('excluded-' + index, 5, 100), cost })),
    ])
    const before = source.map(row => ({ ...row }))
    const rows = summarizeLedgerSessions(source)
    expect(rows.map(row => row.id)).toEqual(['tie-a', 'tie-b', 'older'])
    expect(rows.map(row => row.totalTokens)).toEqual([120, 180, 60])
    expect(source).toEqual(before)
    expect(source.reduce((sum, row) => sum + row.totalTokens, 0)).toBe(1860)
  })
})

describe('Beijing day half-open interval', () => {
  it('F6 includes midnight and next-midnight-minus-1ms but excludes both outside points', () => {
    const start = Date.parse('2026-10-01T16:00:00.000Z')
    const end = Date.parse('2026-10-02T16:00:00.000Z')
    const records: UsageRecord[] = [start - 1, start, end - 1, end].map((timestamp, index) => ({
      sessionId: 'f6-' + index, turn: 1, step: 1, timestamp, provider: 'fixture-provider-a', model: 'fixture-model-x',
      inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: 0,
      costInput: 2 ** index, costCache: 0, costCacheRead: 0, costCacheWrite: 0, costOutput: 0, cost: 2 ** index, peak: false,
    }))
    expect(records.map(row => beijingDateKey(row.timestamp))).toEqual(['2026-10-01', '2026-10-02', '2026-10-02', '2026-10-03'])
    expect(summarizeTodaySpend(records, start + 12 * 3600_000)).toMatchObject({ date: '2026-10-02', calls: 2, cost: 6 })
    expect(records.map(row => summarizeTodaySpend([row], start + 12 * 3600_000).calls)).toEqual([0, 1, 1, 0])
  })
})
