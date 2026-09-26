/** Detailed usage telemetry kept separate from the charge ledger. */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { replaceHistoryFile } from './history-file.ts'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { assistantStreamFirstTokenTime, lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { Session } from '@deepseek-ai/dsh-session'
import type { DetailRow, DetailSession } from '@deepseek-ai/dsh-token-monitor-contract'
import type { PricingTable } from './pricing.ts'
import { DetailQueries } from './detail-query.ts'
import { createRouteGuard } from './http-trust.ts'

export { DetailQueries } from './detail-query.ts'
/** Load titles on demand once per persisted revision, only for recorded sessions. */
export function createMetadataLoader(ctx: Context, store: DetailStore, ids: () => string[]) {
  const revisions = new Map<string, unknown>()
  let pending: Promise<void> | undefined
  let active = true
  ctx.effect(() => async () => { active = false; await pending }, 'token-monitor: metadata loading')
  return () => {
    if (!active) return Promise.resolve()
    return pending ??= (async () => {
    const persistence = ctx.get('sessionPersistence', false)
    if (!persistence) return
    const listed = await persistence.list(), wanted = new Set(ids())
    for (let changed = true; changed;) {
      changed = false
      for (const { header } of listed) if (wanted.has(header.id) && header.origin === 'subagent' && header.parentSession && !wanted.has(header.parentSession)) { wanted.add(header.parentSession); changed = true }
    }
    for (const { header, revision } of listed) {
      if (!active) return
      if (!wanted.has(header.id) || revisions.get(header.id) === revision) continue
      let title = store.sessions.get(header.id)?.title ?? header.id
      try {
        const handle = await persistence.open(header.id, 'read')
        try {
          const { events } = await handle.read(handle.inheritedEventCount)
          const latest = events.findLast(event => event.type === 'session/title')
          if (latest?.type === 'session/title') title = latest.data.title.slice(0, 300)
          revisions.set(header.id, revision)
        } finally { await handle.close() }
      } catch { /* Missing/corrupt old logs still retain ledger rows and their ids. */ }
      if (active) store.remember({ id: header.id, title, project: header.cwd ?? '', child: header.origin === 'subagent', parent: header.origin === 'subagent' ? header.parentSession : undefined })
    }
    })().finally(() => { pending = undefined })
  }
}
export class DetailStore {
  readonly attempts = new Map<string, DetailRow>()
  readonly sessions = new Map<string, DetailSession>()
  private readonly file: string
  /** Erase only plugin request metadata; collection can continue immediately. */
  clear(): void {
    replaceHistoryFile(this.file, '')
    this.attempts.clear()
    this.sessions.clear()
  }
  constructor(dir = dshHomePath('data', 'dsh-token-monitor')) {
    this.file = join(dir, 'request-details.jsonl')
    try {
      mkdirSync(dir, { recursive: true })
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        try {
          const v = JSON.parse(line)
          if (v.kind === 'session' && typeof v.value?.id === 'string' && typeof v.value.title === 'string' && typeof v.value.project === 'string') this.sessions.set(v.value.id, { id: v.value.id, title: v.value.title.slice(0, 300), project: v.value.project, child: v.value.child === true, parent: typeof v.value.parent === 'string' ? v.value.parent : undefined })
          if (v.kind === 'attempt' && validAttempt(v.value)) this.attempts.set(v.value.id, publicAttempt(v.value))
        } catch { /* Preserve later rows after a malformed line. */ }
      }
    } catch { /* No telemetry file exists before activation. */ }
  }
  private save(kind: string, value: unknown) { try { appendFileSync(this.file, JSON.stringify({ kind, value }) + '\n', 'utf8') } catch { console.warn('[dsh-token-monitor] Request metadata persistence failed') } }
  remember(value: DetailSession) { if (JSON.stringify(this.sessions.get(value.id)) !== JSON.stringify(value)) { this.sessions.set(value.id, value); this.save('session', value) } }
  add(value: DetailRow) { if (validAttempt(value) && !this.attempts.has(value.id)) { const safe = publicAttempt(value); this.attempts.set(value.id, safe); this.save('attempt', safe) } }
  latestSuccessful(scope?: { sessionId?: string; provider?: string; model?: string }): DetailRow | undefined {
    // 概览只展示可读字段：优先最近一条含用量/延迟数据的成功记录。若最近的成功请求没有 usage，
    // 整组指标会被显示成“未记录”而掩盖更早的真实用量；全部缺数据时再退回最近的成功记录。
    return [...this.attempts.values()].filter(row => row.status === 'success' && (scope === undefined
      || (scope.sessionId === undefined || row.sessionId === scope.sessionId)
      && (scope.provider === undefined || row.provider === scope.provider)
      && (scope.model === undefined || row.model === scope.model)))
      .sort((a, b) => Number(displaysUsage(b)) - Number(displaysUsage(a)) || b.timestamp - a.timestamp || b.id.localeCompare(a.id))[0]
  }
}
/** 概览快照是否至少含一项可展示数据：tokens 或延迟任一存在即可。 */
function displaysUsage(row: DetailRow): boolean {
  return [row.inputTokens, row.outputTokens, row.cacheReadTokens, row.firstMs, row.totalMs].some(value => value !== undefined)
}
function validAttempt(v: DetailRow): boolean {
  return v != null && typeof v.id === 'string' && typeof v.sessionId === 'string' && typeof v.provider === 'string' && typeof v.model === 'string'
    && Number.isFinite(v.timestamp) && v.timestamp >= 0 && v.timestamp <= 8.64e15 && ['success', 'error', 'cancelled'].includes(v.status)
    && [v.startedAt, v.endedAt, v.firstMs, v.totalMs, v.cost, v.inputTokens, v.outputTokens, v.cacheReadTokens, v.cacheWriteTokens, v.reasoningTokens].every(n => n === undefined || (typeof n === 'number' && Number.isFinite(n) && n >= 0))
    && (v.reasoningEffort === undefined || (typeof v.reasoningEffort === 'string' && v.reasoningEffort.length > 0 && v.reasoningEffort.length <= 80))
    && [v.startedAt, v.endedAt].every(n => n === undefined || n <= 8.64e15)
    && (v.sourceEventSeq === undefined || (Number.isSafeInteger(v.sourceEventSeq) && v.sourceEventSeq >= 0))
    && (v.peak === undefined || typeof v.peak === 'boolean')
    && (v.billingStatus === undefined || ['priced', 'unpriced', 'disabled'].includes(v.billingStatus))
    && (v.billingRuleVersion === undefined || (Number.isSafeInteger(v.billingRuleVersion) && v.billingRuleVersion >= 0))
    && (v.modelMultiplier === undefined || (Number.isFinite(v.modelMultiplier) && v.modelMultiplier > 0))
    && (v.httpStatus === undefined || (Number.isInteger(v.httpStatus) && v.httpStatus >= 100 && v.httpStatus <= 599))
}
/** Select only product-visible fields from durable rows, excluding unknown historical fields. */
export function publicAttempt(v: DetailRow): DetailRow {
  return { id: v.id, sessionId: v.sessionId, sourceEventSeq: v.sourceEventSeq, timestamp: v.timestamp, provider: v.provider, model: v.model, status: v.status, startedAt: v.startedAt, endedAt: v.endedAt, firstMs: v.firstMs, totalMs: v.totalMs, inputTokens: v.inputTokens, outputTokens: v.outputTokens, cacheReadTokens: v.cacheReadTokens, cacheWriteTokens: v.cacheWriteTokens, cost: v.cost, peak: v.peak, billingStatus: v.billingStatus, billingRuleVersion: v.billingRuleVersion, modelMultiplier: v.modelMultiplier, reasoningTokens: v.reasoningTokens, reasoningEffort: v.reasoningEffort, httpStatus: v.httpStatus, errorType: v.errorType === undefined ? undefined : ['rate_limit', 'authentication', 'server', 'timeout', 'network', 'unknown'].includes(v.errorType) ? v.errorType : 'unknown' }
}
export function classifyFailure(code: string, status?: number): string { if (status === 429) return 'rate_limit'; if (status === 401 || status === 403) return 'authentication'; if (status !== undefined && status >= 500) return 'server'; if (/timeout/i.test(code)) return 'timeout'; if (/connect|network/i.test(code)) return 'network'; return 'unknown' }
export function attachDetails(ctx: Context, store: DetailStore, _table: PricingTable) {
  const active = new WeakMap<Session, { at: number; turn: number; step: number; provider?: string; model?: string; reasoningEffort?: string }>()
  const remember = (s: Session, title?: string) => store.remember({ id: s.id, title: title ?? store.sessions.get(s.id)?.title ?? s.id, project: s.header.cwd ?? '', child: s.header.origin === 'subagent', parent: s.header.origin === 'subagent' ? s.header.parentSession : undefined })
  for (const s of ctx.sessions.list()) remember(s)
  ctx.on('session/created', s => remember(s))
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type === 'start') {
      // The loop commits request/header before start and settles before end.
      const config = agent.session.requestHeader()?.config
      active.set(agent.session, { at: Date.now(), turn: frame.turn, step: frame.step, ...config === undefined ? {} : { provider: config.provider, model: config.model, ...config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort } } })
    } else if (frame.type === 'end') active.delete(agent.session)
  })
  ctx.on('session/event', (s, event) => {
    if (event.seq < s.firstLiveSeq) return
    if (event.type === 'session/title') { remember(s, event.data.title.slice(0, 300)); return }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return
    remember(s)
    const messageSource = event.type === 'assistant/message' ? event.data.message.source : undefined
    if (messageSource && messageSource.kind !== 'model') return
    const candidate = active.get(s)
    const live = candidate?.turn === event.data.turn && candidate.step === event.data.step ? candidate : undefined
    const source = messageSource?.kind === 'model' ? messageSource : live
    if (!source?.provider || !source.model) return
    const stream = event.data.stream ?? [], finish = lastAssistantStreamChunk(stream, 'finish')?.reason, failure = finish?.kind === 'error' || finish?.kind === 'aborted' ? finish.failure : undefined
    const usage = event.type === 'assistant/message' ? event.data.usage : lastAssistantStreamChunk(stream, 'usage')?.usage
    // Fees come exclusively from the frozen ledger when queries merge these rows.
    const startedAt = live?.at, endedAt = startedAt === undefined ? undefined : Date.now(), first = assistantStreamFirstTokenTime(stream)
    store.add({ id: `${s.id}:${event.seq}`, sessionId: s.id, sourceEventSeq: event.seq, timestamp: event.time, provider: source.provider, model: source.model, status: finish?.kind === 'aborted' || (event.type === 'assistant/message' && event.data.interrupted) ? 'cancelled' : event.type === 'assistant/attempt' || finish?.kind === 'error' ? 'error' : 'success', startedAt, endedAt, firstMs: startedAt !== undefined && first !== undefined && first >= startedAt ? first - startedAt : undefined, totalMs: startedAt !== undefined && endedAt !== undefined && endedAt >= startedAt ? endedAt - startedAt : undefined, reasoningEffort: live?.provider === source.provider && live.model === source.model ? live.reasoningEffort : undefined, reasoningTokens: usage?.reasoningTokens, cacheWriteTokens: usage?.cacheWriteTokens, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, cacheReadTokens: usage ? usage.cacheReadTokens ?? 0 : undefined, errorType: failure ? classifyFailure(failure.code, failure.status) : undefined, httpStatus: failure?.status })
  })
}
/** Register the details endpoint for the lifetime of the web plugin. */
export function registerDetailsRoute(ctx: Context, queries: DetailQueries, prepare: () => Promise<void> = async () => {}) {
  const guard = createRouteGuard(ctx)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/token-monitor/details', handler: async (req,res) => {
   if (!guard(req, res)) return
   if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
  try { const params = new URL(req.url ?? '/', 'http://localhost').searchParams; if (!params.get('snapshot')) await prepare(); const result=queries.query(params); res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(result)) }
  catch (error) { const code=error instanceof Error && ['INVALID_QUERY','INVALID_TIME','SNAPSHOT_EXPIRED'].includes(error.message) ? error.message : 'DETAILS_UNAVAILABLE'; res.writeHead(code === 'SNAPSHOT_EXPIRED' ? 409 : 400, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify({error:code})) }
 } }), 'dsh-token-monitor: details')
}

/** Register the lightweight latest-request snapshot used by the balance widget. */
export function registerOverviewRoute(ctx: Context, store: DetailStore, prepare: () => Promise<void> = async () => {}) {
  const guard = createRouteGuard(ctx)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/token-monitor/overview', handler: async (req, res) => {
   if (!guard(req, res)) return
   if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
  await prepare()
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams
  const sessionId = params.get('sessionId') || undefined
  const provider = params.get('provider') || undefined
  const model = params.get('model') || undefined
  const scoped = sessionId !== undefined || provider !== undefined || model !== undefined
  const row = store.latestSuccessful(scoped ? {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
  } : undefined)
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(row === undefined ? null : { timestamp: row.timestamp, sessionId: row.sessionId, provider: row.provider, inputTokens: row.inputTokens ?? null, outputTokens: row.outputTokens ?? null, cacheReadTokens: row.cacheReadTokens ?? null, firstMs: row.firstMs ?? null, totalMs: row.totalMs ?? null, model: row.model }))
 } }), 'dsh-token-monitor: overview')
}
