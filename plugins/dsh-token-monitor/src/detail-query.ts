import type { DetailRow, DetailSession, DetailPage } from '@deepseek-ai/dsh-token-monitor-contract'
import type { UsageStorage } from './storage.ts'
import type { DetailStore } from './details.ts'
import { publicAttempt } from './details.ts'
import type { PricingTable } from './pricing.ts'
import { displayProviderId, sameProviderFamily } from './pricing.ts'

/** Freeze query membership while the user pages through incoming request history. */
export class DetailQueries {
  private snapshots = new Map<string, { at: number; rows: DetailRow[]; sessions: DetailSession[] }>()
  private generation = 0
  constructor(private ledger: UsageStorage, private store: DetailStore, _table: PricingTable) {}
  /** Query one bounded page; reject invalid time bounds and expired snapshots. */
  query(p: URLSearchParams, now = Date.now()): DetailPage {
    const size = Number(p.get('size') ?? 20), page = Number(p.get('page') ?? 1), tab = p.get('tab') ?? 'usage', range = p.get('range') ?? 'today'
    if (![20, 50, 100].includes(size) || !Number.isSafeInteger(page) || page < 1 || !['usage', 'errors'].includes(tab) || !['all', '30d', '7d', 'yesterday', 'today', 'custom'].includes(range)) throw new Error('INVALID_QUERY')
    let token = p.get('snapshot') ?? '', snapshot = this.snapshots.get(token)
    if (token && (!snapshot || now - snapshot.at > 30 * 60_000)) throw new Error('SNAPSHOT_EXPIRED')
    if (!snapshot) {
      const merged = new Map<string, DetailRow>()
      this.ledger.history().forEach((record, index) => {
        const id = record.sourceEventSeq === undefined ? 'legacy:' + index : record.sessionId + ':' + record.sourceEventSeq
        const telemetry = this.store.attempts.get(id)
        const row = publicAttempt({ ...telemetry, ...record, id, status: telemetry?.status ?? 'success' })
        row.feeExplanation = { ...(record.billingRule ? { rule: structuredClone(record.billingRule) } : {}),
          ...(record.billingApplied ? { applied: structuredClone(record.billingApplied) } : {}),
          ...(record.billingReason ? { reason: record.billingReason } : {}),
          costInput: record.costInput, costOutput: record.costOutput,
          ...(record.cacheBreakdownRecorded === false ? {} : { costCacheRead: record.costCacheRead, costCacheWrite: record.costCacheWrite }) }
        merged.set(id, row)
      })
      for (const row of this.store.attempts.values()) if (!merged.has(row.id)) merged.set(row.id, row)
      snapshot = { at: now, sessions: [...this.store.sessions.values()], rows: [...merged.values()].sort((a,b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id)) }
      token = now + ':' + ++this.generation
      if (this.snapshots.size >= 8) this.snapshots.delete(this.snapshots.keys().next().value!)
      this.snapshots.set(token, snapshot)
    }
    const midnight = Math.floor((snapshot.at + 8 * 3600_000) / 86400_000) * 86400_000 - 8 * 3600_000
    let from = range === 'all' ? 0 : midnight - (range === '7d' ? 6 : range === '30d' ? 29 : 0) * 86400_000, to = snapshot.at
    if (range === 'yesterday') { from = midnight - 86400_000; to = midnight - 1 }
    if (range === 'custom') {
      from = Number(p.get('from')); to = Number(p.get('to'))
      if (!p.has('from') || !p.has('to') || !Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) throw new Error('INVALID_TIME')
    }
    const sessions = new Map(snapshot.sessions.map(s => [s.id, s])), session = p.get('session')
    const belongs = (id: string) => {
      const visited = new Set<string>()
      while (id && !visited.has(id)) { if (id === session) return true; visited.add(id); id = sessions.get(id)?.parent ?? '' }
      return false
    }
    const rows = snapshot.rows.filter(row => row.timestamp >= from && row.timestamp <= to
      && sameProviderFamily(p.get('provider'), row.provider)
      && (tab === 'usage' ? row.status === 'success' : row.status === 'error' || (p.get('cancelled') === 'true' && row.status === 'cancelled'))
      && (!p.get('model') || row.model === p.get('model')) && (!p.get('project') || sessions.get(row.sessionId)?.project === p.get('project'))
      && (!p.get('sessionText') || ((sessions.get(row.sessionId)?.title ?? '') + ' ' + row.sessionId).toLowerCase().includes(p.get('sessionText')!.toLowerCase()))
      && (!session || belongs(row.sessionId)) && (tab === 'usage' || !p.get('errorType') || (row.errorType ?? 'unknown') === p.get('errorType')))
    const pages = Math.max(1, Math.ceil(rows.length / size)), actual = Math.min(page, pages)
    return { snapshot: token, capturedAt: snapshot.at, rows: rows.slice((actual - 1) * size, actual * size), total: rows.length, page: actual, pages, size,
  sessions: snapshot.sessions, models: [...new Set(snapshot.rows.filter(r => sameProviderFamily(p.get('provider'), r.provider)).map(r => r.model))].sort(),
      providers: [...new Set(snapshot.rows.map(r => displayProviderId(r.provider)))].sort() }
  }
}
