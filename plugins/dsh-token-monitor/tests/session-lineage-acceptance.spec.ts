import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type CreateSessionOptions } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { attachDetails, DetailStore } from '../src/details.ts'
import { PRICE_TABLE } from '../src/pricing.ts'
import { summarizeLedgerSessions } from '../src/session-costs-route.ts'
import { UsageStorage } from '../src/storage.ts'

vi.mock('@deepseek-ai/dsh-home-paths', async () => {
  const { join: joinPath } = await import('node:path')
  const { tmpdir: temporaryDirectory } = await import('node:os')
  return { dshHomePath: (...parts: string[]) => joinPath(temporaryDirectory(), 'lineage-default-unused', ...parts) }
})

type Creation = { id: string; meta?: CreateSessionOptions['meta'] }
const projectA = resolve(tmpdir(), 'lineage-project-a')
const projectB = resolve(tmpdir(), 'lineage-project-b')
const expectedRows = JSON.parse(readFileSync(new URL('./expected/session-lineage.json', import.meta.url), 'utf8'))
const child = (id: string, parent?: string, cwd?: string): Creation => ({ id, meta: {
  origin: 'subagent', ...(parent === undefined ? {} : { parentSession: SessionId(parent) }),
  ...(cwd === undefined ? {} : { cwd }),
} })
const root = (cwd?: string): Creation => ({ id: 'root', ...(cwd === undefined ? {} : { meta: { cwd } }) })

// SessionHeader defines parentSession as fork lineage; child-agent.ts additionally
// stamps origin=subagent and inherits cwd only when the parent's cwd is defined.
const cases: { name: string; creations: Creation[]; merged: boolean }[] = [
  { name: 'explicit subagent lineage with both cwd absent', creations: [root(), child('leaf', 'root')], merged: true },
  { name: 'explicit subagent lineage with child cwd absent', creations: [root(projectA), child('leaf', 'root')], merged: true },
  { name: 'explicit subagent lineage with parent cwd absent', creations: [root(), child('leaf', 'root', projectA)], merged: true },
  { name: 'fork parent without subagent origin is not delegation', creations: [root(projectA), { id: 'leaf', meta: { parentSession: SessionId('root'), cwd: projectA } }], merged: false },
  { name: 'subagent origin without a parent stays unassigned', creations: [root(projectA), child('leaf', undefined, projectA)], merged: false },
  { name: 'missing ancestor stays unassigned', creations: [root(projectA), child('leaf', 'missing', projectA)], merged: false },
  { name: 'different adjacent projects do not merge', creations: [root(projectB), child('leaf', 'root', projectA)], merged: false },
  { name: 'unknown middle does not bridge different known endpoints', creations: [root(projectB), child('middle', 'root'), child('leaf', 'middle', projectA)], merged: false },
  { name: 'unknown middle preserves matching known endpoints', creations: [root(projectA), child('middle', 'root'), child('leaf', 'middle', projectA)], merged: true },
  { name: 'known different middle blocks matching endpoints', creations: [root(projectA), child('middle', 'root', projectB), child('leaf', 'middle', projectA)], merged: false },
]

describe('A07 actual SessionHeader to detail metadata and ledger ancestry', () => {
  it.each(cases)('$name', async ({ creations, merged }) => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-lineage-'))
    const ctx = new Context()
    const sessions = ctx.plugin(SessionStore)
    let details: ReturnType<Context['plugin']> | undefined
    try {
      await sessions
      // Existing sessions exercise initial enumeration; the leaf exercises created events.
      for (const creation of creations.slice(0, -1)) ctx.sessions.create(SessionId(creation.id), creation.meta === undefined ? undefined : { meta: creation.meta })
      const store = new DetailStore(directory)
      details = ctx.plugin({ inject: ['sessions'], apply(scope: Context) { attachDetails(scope, store, PRICE_TABLE) } })
      await details
      const leaf = creations.at(-1)!
      ctx.sessions.create(SessionId(leaf.id), leaf.meta === undefined ? undefined : { meta: leaf.meta })
      await new Promise<void>(resolveMicrotask => queueMicrotask(resolveMicrotask))
      for (const creation of creations) {
        const actual = ctx.sessions.get(SessionId(creation.id))!
        expect(store.sessions.get(creation.id)).toEqual({ id: creation.id, title: creation.id,
          project: actual.header.cwd ?? '', child: actual.header.origin === 'subagent',
          parent: actual.header.origin === 'subagent' ? actual.header.parentSession : undefined })
      }
      const storage = new UsageStorage(() => true, directory)
      storage.add({ sessionId: 'leaf', turn: 1, step: 1, timestamp: 31,
        provider: 'fixture-provider', model: 'fixture-model', inputTokens: 11, cacheReadTokens: 13,
        cacheWriteTokens: 17, outputTokens: 19, reasoningTokens: 7, costInput: 3, costCache: 0,
        costCacheRead: 0, costCacheWrite: 0, costOutput: 0, cost: 3, peak: false })
      const ledger = join(directory, 'usage.jsonl')
      const ledgerBytes = readFileSync(ledger)
      const metadataBytes = readFileSync(join(directory, 'request-details.jsonl'))
      const original = storage.list()
      const expected = merged ? expectedRows.merged : expectedRows.unassigned
      for (const metadata of [store.sessions, new DetailStore(directory).sessions]) {
        expect(summarizeLedgerSessions(original, metadata)).toEqual(expected)
        expect(readFileSync(ledger)).toEqual(ledgerBytes)
        expect(readFileSync(join(directory, 'request-details.jsonl'))).toEqual(metadataBytes)
        expect(storage.list()).toEqual(original)
      }
    } finally {
      try { await details?.dispose(); await sessions.dispose() }
      finally { rmSync(directory, { recursive: true, force: true }) }
    }
  })
})
