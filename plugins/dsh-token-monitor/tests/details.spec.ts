import { mkdtempSync, appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore from '@deepseek-ai/dsh-session'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { DetailStore, attachDetails, classifyFailure, registerDetailsRoute, registerOverviewRoute } from '../src/details.ts'
import { DetailQueries } from '../src/detail-query.ts'
import { PRICE_TABLE } from '../src/pricing.ts'
import type { DetailRow } from '@deepseek-ai/dsh-token-monitor-contract'
import { UsageStorage } from '../src/storage.ts'

const dirs: string[] = [], contexts: Context[] = []
const now = Date.parse('2026-09-14T10:00:00Z')
const row = (id: string, patch: Partial<DetailRow> = {}): DetailRow => ({ id, sessionId: 'parent', timestamp: now - 1000, provider: 'deepseek-official', model: 'deepseek-v4-flash', status: 'success', ...patch })
function setup() { const dir = mkdtempSync(join(tmpdir(), 'dsh-details-')); dirs.push(dir); const store = new DetailStore(dir); const ledger = { history: () => [] }; return { dir, store, queries: new DetailQueries(ledger as never, store, PRICE_TABLE) } }
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('detailed usage', () => {
  it('never borrows latest request tokens from another session, provider or model', () => {
    const { store } = setup()
    store.add(row('own', { provider: 'a', model: 'm' }))
    store.add(row('background', { sessionId: 'background', provider: 'a', model: 'm', timestamp: now }))
    store.add(row('other-provider', { provider: 'b', model: 'm', timestamp: now }))
    expect(store.latestSuccessful({ sessionId: 'parent', provider: 'a', model: 'm' })?.id).toBe('own')
    expect(store.latestSuccessful({ sessionId: 'parent', provider: 'a', model: 'new-model' })).toBeUndefined()
    expect(store.latestSuccessful({ provider: 'a', model: 'm' })?.id).toBe('background')
  })
  it('prefers the newest success that has usage or latency data without dropping a bare fallback', () => {
    const { store } = setup()
    store.add(row('with-usage', { inputTokens: 100, outputTokens: 20, timestamp: now - 5000 }))
    store.add(row('bare-newer', { timestamp: now }))
    expect(store.latestSuccessful({ sessionId: 'parent' })?.id).toBe('with-usage')
    const onlyBare = setup().store
    onlyBare.add(row('bare-older', { firstMs: undefined, timestamp: now - 5000 }))
    onlyBare.add(row('bare-newer', { timestamp: now }))
    expect(onlyBare.latestSuccessful({ sessionId: 'parent' })?.id).toBe('bare-newer')
  })
  it('filters providers without merging same-name models and preserves yesterday boundaries', () => {
    const { store, queries } = setup()
    const midnight = Date.parse('2026-09-13T16:00:00Z')
    store.add(row('a', { provider: 'a', timestamp: midnight - 1 }))
    store.add(row('b', { provider: 'b', timestamp: midnight - 1 }))
    store.add(row('today', { provider: 'a', timestamp: midnight }))
    store.add(row('start', { provider: 'a', timestamp: midnight - 86400_000 }))
    store.add(row('old', { provider: 'a', timestamp: midnight - 86400_001 }))
    const result = queries.query(new URLSearchParams({ range: 'yesterday', provider: 'a' }), now)
    expect(result.rows.map(item => item.id)).toEqual(['a', 'start'])
    expect(result.providers).toEqual(['a', 'b'])
  })
  it('shows missing legacy cache subtotals as unknown without rewriting or recalculating the ledger', () => {
    const { dir, store } = setup()
    const legacy = { sessionId: 'parent', provider: 'v', model: 'm', turn: 1, step: 1, timestamp: now - 1000, inputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 300, outputTokens: 50, reasoningTokens: 0, costInput: 1, costCache: 2, costOutput: 3, cost: 6, peak: false }
    const original = JSON.stringify(legacy) + '\n'
    writeFileSync(join(dir, 'usage.jsonl'), original)
    const ledger = new UsageStorage(() => true, dir)
    const record = new DetailQueries(ledger, store, PRICE_TABLE).query(new URLSearchParams({ range: 'all' }), now).rows[0]!
    expect(record.cost).toBe(6)
    expect(record.feeExplanation).toEqual({ costInput: 1, costOutput: 3 })
    expect(record.feeExplanation?.applied).toBeUndefined()
    expect(readFileSync(join(dir, 'usage.jsonl'), 'utf8')).toBe(original)
  })
  it('normalizes durable metadata and rejects invalid time and numeric fields', () => {
    const { store, dir } = setup()
    store.add(row('private', { errorType: 'PRIVATE ERROR', rawBody: 'SECRET' } as Partial<DetailRow>))
    store.add(row('bad-time', { timestamp: 9e15 }))
    store.add(row('bad-seq', { sourceEventSeq: -1 }))
    store.add(row('bad-cache', { cacheWriteTokens: -1 }))
    expect(store.attempts.size).toBe(1)
    expect(store.attempts.get('private')?.errorType).toBe('unknown')
    expect(readFileSync(join(dir, 'request-details.jsonl'), 'utf8')).not.toContain('SECRET')
    expect(new DetailStore(dir).attempts.size).toBe(1)
  })
  it('records per-attempt latency and excludes replayed settlement events', async () => {
    const { store } = setup()
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(SessionStore)
    attachDetails(ctx, store, PRICE_TABLE)
    const session = ctx.sessions.create()
    const clock = vi.spyOn(Date, 'now')
    try {
      clock.mockReturnValue(now)
      await ctx.emit('agent/assistant-stream', { agent: { session }, frame: { type: 'start', turn: 1, step: 1 } } as never)
      clock.mockReturnValue(now + 4000)
      session.append('assistant/message', { turn: 1, step: 1, stream: [{ type: 'chunk', time: now + 1200, chunk: { type: 'text-delta', index: 0, text: 'PRIVATE' } }], message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' } }), usage: { inputTokens: 100, outputTokens: 20 } }, { surfaceOp: 'append' })
      expect([...store.attempts.values()][0]).toMatchObject({ firstMs: 1200, totalMs: 4000, startedAt: now, endedAt: now + 4000 })
      const own = [...store.attempts.values()][0]!
      await ctx.emit('session/event', { ...session, firstLiveSeq: 100 } as never, { type: 'assistant/message', seq: 99, data: {} } as never)
      store.add(own)
      expect(store.attempts.size).toBe(1)
    } finally { clock.mockRestore() }
  })
  it('freezes reasoning metadata per attempt and retains it across telemetry reload', async () => {
    const { store, dir } = setup()
    const ctx = new Context(); contexts.push(ctx); await ctx.plugin(SessionStore)
    attachDetails(ctx, store, PRICE_TABLE)
    const session = ctx.sessions.create()
    const header = (reasoningEffort: string) => session.append('request/header', { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort } }, reason: 'change' } as never)
    const start = () => ctx.emit('agent/assistant-stream', { agent: { session }, frame: { type: 'start', turn: 1, step: 1 } } as never)
    const finish = () => ctx.emit('agent/assistant-stream', { agent: { session }, frame: { type: 'end' } } as never)
    const message = (step = 1) => session.append('assistant/message', { turn: 1, step, stream: [], message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' } }), usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 12, cacheWriteTokens: 3 } }, { surfaceOp: 'append' })
    header('high'); await start(); header('low'); message(); await finish()
    await start(); message(); await finish()
    header('max'); message(2)
    const rows = [...new DetailStore(dir).attempts.values()]
    expect(rows.map(row => row.reasoningEffort)).toEqual(['high', 'low', undefined])
    expect(rows[0]).toMatchObject({ reasoningTokens: 12, outputTokens: 20, cacheWriteTokens: 3 })
    const { store: other } = setup()
    other.add(row('invalid-effort', { reasoningEffort: '' })); other.add(row('invalid-reasoning', { reasoningTokens: -1 }))
    expect(other.attempts.size).toBe(0)
  })
  it('filters provider and model together, includes explicit children and preserves a paging snapshot', () => {
    const { store, queries } = setup()
    store.remember({ id: 'parent', title: 'Same title', project: 'project', child: false })
    store.remember({ id: 'child', title: 'Child', project: 'project', child: true, parent: 'parent' })
    for (let i = 0; i < 25; i++) store.add(row(String(i), { sessionId: i % 2 ? 'child' : 'parent', timestamp: now - i - 1 }))
    store.add(row('foreign', { provider: 'other' })); store.add(row('unknown', { model: 'new-unknown-model' }))
    const first = queries.query(new URLSearchParams({ session: 'parent', project: 'project' }), now)
    expect(first.total).toBe(27); expect(first.rows).toHaveLength(20)
    store.add(row('arrived', { timestamp: now }))
    const next = queries.query(new URLSearchParams({ snapshot: first.snapshot, page: '2' }), now)
    expect(next.rows).toHaveLength(7); expect(next.total).toBe(27)
    expect(queries.query(new URLSearchParams(), now).total).toBe(28)
    expect(() => queries.query(new URLSearchParams({ snapshot: first.snapshot }), now + 1_800_001)).toThrow('SNAPSHOT_EXPIRED')
  })
  it('keeps legacy costs and missing timings, joins telemetry without a second charge', () => {
    const { store } = setup()
    store.add(row('parent:7', { sourceEventSeq: 7, cost: 999, firstMs: 1200, totalMs: 5000 }))
    const ledger = { history: () => [{ ...row('ignored'), sourceEventSeq: 7, cost: 0.123456, peak: true }, { ...row('legacy'), cost: 0.01, peak: false }] }
    const page = new DetailQueries(ledger as never, store, PRICE_TABLE).query(new URLSearchParams(), now)
    expect(page.total).toBe(2)
    expect(page.rows.find(r => r.id === 'parent:7')).toMatchObject({ cost: 0.123456, firstMs: 1200, peak: true })
    expect(page.rows.find(r => r.id.startsWith('legacy:'))?.firstMs).toBeUndefined()
  })
  it('separates retries, cancellation and unknown usage without leaking failure text', () => {
    const { store, queries, dir } = setup()
    store.add(row('error1', { status: 'error', errorType: classifyFailure('anything', 429), httpStatus: 429 }))
    store.add(row('error2', { status: 'error', errorType: 'timeout' }))
    store.add(row('cancel', { status: 'cancelled' })); store.add(row('ok'))
    expect(queries.query(new URLSearchParams({ tab: 'errors' }), now).total).toBe(2)
    expect(queries.query(new URLSearchParams({ tab: 'errors', cancelled: 'true' }), now).total).toBe(3)
    expect(queries.query(new URLSearchParams({ tab: 'errors', errorType: 'rate_limit' }), now).rows[0]?.cost).toBeUndefined()
    expect(queries.query(new URLSearchParams({ errorType: 'timeout' }), now).total).toBe(1)
    appendFileSync(join(dir, 'request-details.jsonl'), '\n{broken\n')
    store.add(row('later'))
    expect(new DetailStore(dir).attempts.size).toBe(5)
    expect(readFileSync(join(dir, 'request-details.jsonl'), 'utf8')).not.toContain('Authorization')
  })
  it('uses Beijing inclusive boundaries and rejects bad query values', () => {
    const { store, queries } = setup()
    store.add(row('before', { timestamp: Date.parse('2026-09-13T15:59:59Z') }))
    store.add(row('today', { timestamp: Date.parse('2026-09-13T16:00:00Z') }))
    expect(queries.query(new URLSearchParams(), now).rows.map(r => r.id)).toEqual(['today'])
    expect(queries.query(new URLSearchParams({ range: 'all' }), now).total).toBe(2)
    expect(() => queries.query(new URLSearchParams({ size: '999' }), now)).toThrow('INVALID_QUERY')
    expect(() => queries.query(new URLSearchParams({ range: 'custom', from: '1', to: '0' }), now)).toThrow('INVALID_TIME')
  })
  it('boots through real Loader and serves recorded official usage over HTTP', async () => {
    const { store, queries, dir } = setup()
    const ctx = new Context(); contexts.push(ctx)
    ctx.baseUrl = pathToFileURL(dir).href + '/'
    await ctx.plugin(Loader); ctx.loader.builtins.include = Include
    const feature = { inject: ['sessions', 'webServer', 'connection'], apply(context: Context) { attachDetails(context, store, PRICE_TABLE); registerDetailsRoute(context, queries) } }
    const trust = { apply(context: Context) { context.provide('connection', { requestRejection: () => undefined }) } }
    const modules = new Map<string, unknown>([['sessions', SessionStore], ['webserver', HttpServer], ['trust', trust], ['details', feature]])
    ctx.loader.internal = { version: 'v2', async import(name: string) { return modules.get(name) } } as never
    const config = join(dir, 'cordis.yml')
    writeFileSync(config, '- name: sessions\n- name: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n- name: trust\n- name: details\n')
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } }); await ctx.loader.await()
    const session = ctx.sessions.create()
    session.append('assistant/message', { stream: [], turn: 1, step: 1, message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'PRIVATE BODY' }], source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' } }), usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 400 } }, { surfaceOp: 'append' })
    const response = await fetch('http://127.0.0.1:' + ctx.webServer.port + '/api/token-monitor/details?range=all')
    const payload = await response.json()
    expect(response.status).toBe(200); expect(payload.total).toBe(1)
    expect(payload.rows[0]).toMatchObject({ inputTokens: 120, outputTokens: 30, cacheReadTokens: 400 })
    expect(payload.rows[0].firstMs).toBeUndefined()
    expect(JSON.stringify(payload)).not.toContain('PRIVATE BODY')
    expect((await fetch('http://127.0.0.1:' + ctx.webServer.port + '/api/token-monitor/details', { method: 'POST' })).status).toBe(405)
  })
})
