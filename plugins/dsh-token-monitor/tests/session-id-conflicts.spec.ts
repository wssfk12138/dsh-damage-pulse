import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { summarizeLedgerSessions } from '../src/session-costs-route.ts'
import { UsageStorage } from '../src/storage.ts'
import type { SessionSummary } from '../src/types.ts'
import type { DetailSession } from '@deepseek-ai/dsh-token-monitor-contract'

const summary = (sessionId: string, cost: number, lastActivity = 1): SessionSummary => ({
  sessionId, cost, calls: 1, inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, totalTokens: 2, lastActivity,
})
const meta = (id: string, parent?: string, project = 'one'): DetailSession => ({ id, title: id, project, child: parent !== undefined, ...(parent ? { parent } : {}) })
const amounts = (rows: ReturnType<typeof summarizeLedgerSessions>) => Object.fromEntries(rows.map(row => [row.id, row.cost]))

function expectConflict(rows: ReturnType<typeof summarizeLedgerSessions>, id: string, raw: string[]) {
  const row = rows.find(row => row.id === id)
  expect(row).toMatchObject({ id, sessionId: id, status: 'conflict', cost: null, conflicts: [expect.objectContaining({ normalizedId: 'x', rawSessionIds: raw })] })
  expect(row).not.toHaveProperty('calls')
  expect(row).not.toHaveProperty('totalTokens')
}

describe('A08 explicit session identity conflicts', () => {
  it('aliases and duplicate summaries never pick a winner, dedupe by value, or show a trusted root amount', () => {
    const sessions = new Map([['root', meta('root')], ['x', meta('x', 'root')], ['unrelated', meta('unrelated')]])
    for (const collision of [[summary('x', 2), summary('session-x', 3)], [summary('x', 2), summary('x', 2)], [summary('x', 0), summary('session-x', 3)]]) {
      for (const source of [collision, [...collision].reverse()]) {
        const input = Object.freeze([...source.map(row => Object.freeze(row)), Object.freeze(summary('root', 1)), Object.freeze(summary('unrelated', 7))])
        const before = structuredClone(input)
        const rows = summarizeLedgerSessions(input, sessions)
        const raw = [...new Set(collision.map(row => row.sessionId))].sort()
        expectConflict(rows, 'x', raw)
        expectConflict(rows, 'root', raw)
        expect(amounts(rows)).toEqual({ x: null, root: null, unrelated: 7 })
        expect(input).toEqual(before)
        expect(summarizeLedgerSessions(input, sessions)).toEqual(rows)
      }
    }
  })

  it('metadata aliases with different projects/parents suppress both possible roots without inventing ownership', () => {
    const entries: [string, DetailSession][] = [['x', meta('x', 'root-a', 'a')], ['session-x', meta('session-x', 'root-b', 'b')], ['root-a', meta('root-a', undefined, 'a')], ['root-b', meta('root-b', undefined, 'b')]]
    for (const metadata of [entries, [...entries].reverse()]) {
      const rows = summarizeLedgerSessions([summary('x', 2), summary('root-a', 1), summary('root-b', 3), summary('other', 8)], new Map(metadata))
      for (const id of ['x', 'root-a', 'root-b']) expectConflict(rows, id, ['session-x', 'x'])
      expect(amounts(rows)).toEqual({ x: null, 'root-a': null, 'root-b': null, other: 8 })
    }
  })

  it('a collision in a middle ancestor reaches the dependent root, including child-only roots', () => {
    const sessions = new Map([['root', meta('root')], ['x', meta('x', 'root')], ['session-x', meta('session-x', 'root')], ['leaf', meta('leaf', 'x')]])
    const rows = summarizeLedgerSessions([summary('leaf', 3)], sessions)
    expectConflict(rows, 'leaf', ['session-x', 'x'])
    expectConflict(rows, 'root', ['session-x', 'x'])
    expect(amounts(rows)).toEqual({ leaf: null, root: null })
  })

  it('a legal unique prefix and a shared metadata object remain usable; removing a collision recovers on the next query', () => {
    const child = meta('x', 'root')
    const sessions = new Map([['x', child], ['session-x', child], ['root', meta('root')]])
    expect(amounts(summarizeLedgerSessions([summary('session-x', 2)], sessions))).toEqual({ x: 2, root: 2 })
    const source = [summary('x', 2), summary('session-x', 3)]
    expectConflict(summarizeLedgerSessions(source, sessions), 'root', ['session-x', 'x'])
    expect(amounts(summarizeLedgerSessions(source.slice(1), sessions))).toEqual({ x: 3, root: 3 })
  })


  it('merges independent conflicts at a root without restoring counters, regardless of input order', () => {
    const metadata: [string, DetailSession][] = [['root', meta('root')], ['x', meta('x', 'root')], ['y', meta('y', 'root')], ['clean', meta('clean', 'root')]]
    const source = [summary('root', 1), summary('x', 2), summary('session-x', 3), summary('y', 4), summary('session-y', 5), summary('clean', 6), summary('other', 7)]
    for (const input of [source, [...source].reverse()]) for (const entries of [metadata, [...metadata].reverse()]) {
      const rows = summarizeLedgerSessions(input, new Map(entries))
      const root = rows.find(row => row.id === 'root')
      expect(root).toMatchObject({ status: 'conflict', cost: null, conflicts: [
        { normalizedId: 'x', rawSessionIds: ['session-x', 'x'], reasons: ['normalized-id-collision'] },
        { normalizedId: 'y', rawSessionIds: ['session-y', 'y'], reasons: ['normalized-id-collision'] },
      ] })
      expect(root).not.toHaveProperty('calls')
      expect(root).not.toHaveProperty('totalTokens')
      expect(amounts(rows)).toEqual({ root: null, x: null, y: null, clean: 6, other: 7 })
    }
  })

  it('a root metadata collision also suppresses its otherwise unique child', () => {
    const entries: [string, DetailSession][] = [['root', meta('root')], ['session-root', meta('session-root')], ['leaf', meta('leaf', 'root')]]
    for (const input of [[summary('leaf', 2), summary('root', 1)], [summary('root', 1), summary('leaf', 2)]]) {
      const rows = summarizeLedgerSessions(input, new Map(entries))
      for (const id of ['leaf', 'root']) {
        const row = rows.find(row => row.id === id)
        expect(row).toMatchObject({ status: 'conflict', cost: null, conflicts: [{ normalizedId: 'root', rawSessionIds: ['root', 'session-root'], reasons: ['metadata-id-collision'] }] })
        expect(row).not.toHaveProperty('calls')
      }
    }
  })

  it('terminates cyclic and missing-parent metadata without inventing a root, and explores a valid conflicting branch', () => {
    const cycle = new Map([['x', meta('x', 'y')], ['y', meta('y', 'x')], ['lost', meta('lost', 'missing')]])
    expect(amounts(summarizeLedgerSessions([summary('x', 2), summary('lost', 3)], cycle))).toEqual({ x: 2, lost: 3 })
    cycle.set('session-x', meta('session-x', 'root'))
    cycle.set('root', meta('root'))
    for (const metadata of [cycle, new Map([...cycle].reverse())]) {
      const rows = summarizeLedgerSessions([summary('y', 2), summary('lost', 3)], metadata)
      expectConflict(rows, 'y', ['session-x', 'x'])
      expectConflict(rows, 'root', ['session-x', 'x'])
      expect(amounts(rows)).toEqual({ y: null, root: null, lost: 3 })
    }
  })

  it('does not rewrite raw ledger identities or global totals when a normalized id collides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-a08-ledger-'))
    try {
      const storage = new UsageStorage(() => true, dir)
      for (const [index, sessionId] of ['x', 'session-x'].entries()) storage.add({ sessionId, provider: 'fixture-provider', model: 'fixture-model', turn: 1, step: 1, sourceEventSeq: index + 1, timestamp: 1000 + index, inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: 0, costInput: index + 2, costCache: 0, costCacheRead: 0, costCacheWrite: 0, costOutput: 0, cost: index + 2, peak: false })
      const file = join(dir, 'usage.jsonl')
      const before = readFileSync(file)
      const rows = summarizeLedgerSessions(storage.list(), new Map([['x', meta('x', 'root')], ['root', meta('root')]]))
      expectConflict(rows, 'x', ['session-x', 'x'])
      expectConflict(rows, 'root', ['session-x', 'x'])
      expect(storage.list().map(row => row.sessionId).sort()).toEqual(['session-x', 'x'])
      expect(storage.list().reduce((sum, row) => sum + row.cost, 0)).toBe(5)
      expect(storage.history()).toHaveLength(2)
      expect(readFileSync(file)).toEqual(before)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
