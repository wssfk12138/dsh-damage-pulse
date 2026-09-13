import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageStorage } from '../src/storage.ts'
import { beijingDateKey, summarizeTodaySpend } from '../src/todaySpend.ts'
import type { UsageRecord } from '../src/types.ts'

const tempDirs: string[] = []

function record(
  timestamp: number,
  cost: number,
  provider = 'deepseek-official',
  model = 'deepseek-chat',
): UsageRecord {
  return {
    sessionId: 'session-1', turn: 1, step: 1, timestamp, provider, model,
    inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: 0,
    costInput: cost, costCache: 0, costCacheRead: 0, costCacheWrite: 0, costOutput: 0, cost, peak: false,
  }
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('today spend aggregation', () => {
  it('uses the Beijing-time midnight boundary', () => {
    expect(beijingDateKey(Date.parse('2026-08-22T15:59:59.999Z'))).toBe('2026-08-22')
    expect(beijingDateKey(Date.parse('2026-08-22T16:00:00.000Z'))).toBe('2026-08-23')
  })

  it('keeps UTC-crossing records in the same Beijing day', () => {
    const now = Date.parse('2026-08-23T01:00:00.000Z')
    const result = summarizeTodaySpend([
      record(Date.parse('2026-08-22T23:50:00.000Z'), 0.1),
      record(Date.parse('2026-08-23T00:10:00.000Z'), 0.2),
    ], now)
    expect(result).toMatchObject({ date: '2026-08-23', calls: 2, currency: 'CNY' })
    expect(result.cost).toBeCloseTo(0.3)
  })

  it('sums eligible records and returns zero for an empty day', () => {
    const records = [record(Date.parse('2026-08-23T03:00:00.000Z'), 0.12), record(Date.parse('2026-08-23T04:00:00.000Z'), 0.34)]
    const current = summarizeTodaySpend(records, Date.parse('2026-08-23T05:00:00.000Z'))
    expect(current.calls).toBe(2)
    expect(current.cost).toBeCloseTo(0.46)
    expect(summarizeTodaySpend(records, Date.parse('2026-08-24T05:00:00.000Z'))).toMatchObject({ cost: 0, calls: 0 })
  })

  it('skips structurally damaged history rows without breaking the endpoint', () => {
    const now = Date.parse('2026-08-23T05:00:00.000Z')
    const damaged = [
      { ...record(now - 3_000, 9), timestamp: Number.NaN },
      { ...record(now - 2_000, 8), cost: Number.NaN },
      { ...record(now - 1_000, -7) },
      record(now, 0.25),
    ]
    expect(summarizeTodaySpend(damaged, now)).toMatchObject({ cost: 0.25, calls: 1 })
  })

  it('aggregates only records accepted by UsageStorage on cold start and add', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-token-monitor-m1-'))
    tempDirs.push(dataDir)
    const now = Date.parse('2026-08-23T05:00:00.000Z')
    writeFileSync(join(dataDir, 'usage.jsonl'), [
      record(now - 1_000, 0.25),
      record(now - 750, 9, 'other-provider'),
      record(now - 500, 8, 'deepseek-official', 'unsupported-model'),
    ].map(JSON.stringify).join('\n') + '\n')
    const storage = new UsageStorage(
      (item) => item.provider === 'deepseek-official' && item.model === 'deepseek-chat',
      dataDir,
    )
    expect(storage.add(record(now, 7, 'other-provider'))).toBeUndefined()
    expect(storage.add(record(now, 6, 'deepseek-official', 'unsupported-model'))).toBeUndefined()
    storage.add(record(now, 0.5))
    expect(storage.todaySpend(now)).toMatchObject({ cost: 0.75, calls: 2 })
  })

  it('rebuilds session summaries when loading history on cold start', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-token-monitor-cold-start-'))
    tempDirs.push(dataDir)
    const first = record(1_000, 0.25)
    first.inputTokens = 3
    first.outputTokens = 2
    const second = { ...record(2_000, 0.5), inputTokens: 4, outputTokens: 1 }
    writeFileSync(join(dataDir, 'usage.jsonl'), `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`)
    const storage = new UsageStorage(() => true, dataDir)
    expect(storage.history()).toHaveLength(2)
    expect(storage.get('session-1')).toMatchObject({ calls: 2, inputTokens: 7, outputTokens: 3, totalTokens: 10, cost: 0.75, lastActivity: 2_000 })
    expect(storage.list()).toHaveLength(1)
  })

  it('normalizes legacy cache cost fields without rewriting usage.jsonl', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-token-monitor-legacy-history-'))
    tempDirs.push(dataDir)
    const now = Date.parse('2026-08-23T05:00:00.000Z')
    const legacy = record(now, 0.25)
    legacy.cacheReadTokens = 4
    legacy.costInput = 0.1
    legacy.costCache = 0.05
    legacy.costCacheRead = 0.05
    legacy.costOutput = 0.1
    const { costCacheRead: _costCacheRead, costCacheWrite: _costCacheWrite, ...legacyRow } = legacy
    const original = `${JSON.stringify(legacyRow)}\n`
    const historyPath = join(dataDir, 'usage.jsonl')
    writeFileSync(historyPath, original)

    const storage = new UsageStorage(() => true, dataDir)

    expect(storage.history()).toEqual([{ ...legacy, costCacheRead: 0.05, costCacheWrite: 0 }])
    expect(storage.get('session-1')).toMatchObject({ calls: 1, cost: 0.25 })
    expect(storage.list()).toHaveLength(1)
    expect(storage.todaySpend(now)).toMatchObject({ calls: 1, cost: 0.25 })
    expect(readFileSync(historyPath, 'utf8')).toBe(original)
  })

  it('keeps large cold-start history aggregation correct without query-time rescans', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-token-monitor-daily-index-'))
    tempDirs.push(dataDir)
    const now = Date.parse('2026-08-23T05:00:00.000Z')
    const today = Array.from({ length: 5_000 }, (_, index) => record(now - index * 1_000, 0.01))
    const previousDay = Array.from({ length: 5_000 }, (_, index) => record(now - 24 * 60 * 60 * 1_000 - index * 1_000, 0.02))
    writeFileSync(join(dataDir, 'usage.jsonl'), [...today, ...previousDay].map(JSON.stringify).join('\n') + '\n')
    const storage = new UsageStorage(() => true, dataDir)
    expect(storage.todaySpend(now).calls).toBe(5_000)
    expect(storage.todaySpend(now).cost).toBeCloseTo(50, 10)
    const previousDayNow = now - 24 * 60 * 60 * 1_000
    expect(storage.todaySpend(previousDayNow).calls).toBe(5_000)
    expect(storage.todaySpend(previousDayNow).cost).toBeCloseTo(100, 10)
  })

  it('deduplicates replayed records by session event sequence', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-token-monitor-idempotency-'))
    tempDirs.push(dataDir)
    const first = { ...record(1_000, 0.25), sourceEventSeq: 42 }
    writeFileSync(join(dataDir, 'usage.jsonl'), `${JSON.stringify(first)}\n${JSON.stringify(first)}\n`)
    const storage = new UsageStorage(() => true, dataDir)
    expect(storage.history()).toHaveLength(1)
    expect(storage.get('session-1')).toMatchObject({ calls: 1, cost: 0.25 })
    expect(storage.add(first)).toBeUndefined()
  })

  it('deduplicates seq-less history rows written before the session event sequence field existed', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-token-monitor-legacy-idempotency-'))
    tempDirs.push(dataDir)
    const now = Date.parse('2026-08-23T05:00:00.000Z')
    const legacy = record(now, 0.25)
    writeFileSync(join(dataDir, 'usage.jsonl'), `${JSON.stringify(legacy)}\n${JSON.stringify(legacy)}\n`)
    const storage = new UsageStorage(() => true, dataDir)
    expect(storage.history()).toHaveLength(1)
    expect(storage.get('session-1')).toMatchObject({ calls: 1, cost: 0.25 })
    expect(storage.add(legacy)).toBeUndefined()
    expect(storage.todaySpend(now)).toMatchObject({ calls: 1, cost: 0.25 })
  })

  it('keeps distinct seq-less rows that share session, turn and step', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-token-monitor-legacy-distinct-'))
    tempDirs.push(dataDir)
    const now = Date.parse('2026-08-23T05:00:00.000Z')
    writeFileSync(join(dataDir, 'usage.jsonl'), [
      record(now - 1_000, 0.25),
      record(now, 0.25),
    ].map(JSON.stringify).join('\n') + '\n')
    const storage = new UsageStorage(() => true, dataDir)
    expect(storage.history()).toHaveLength(2)
    expect(storage.get('session-1')).toMatchObject({ calls: 2, cost: 0.5 })
    expect(storage.todaySpend(now).calls).toBe(2)
  })

  // 该用例做 2_100 次真实同步落盘（每次 add 都 appendFileSync），单跑约 1 s，
  // 但全量并行时多个 worker 争抢 CPU 会超过 vitest 默认的 5 s，故显式放宽。
  it('retains replay identities beyond the transient animation window', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-token-monitor-idempotency-long-'))
    const storage = new UsageStorage(() => true, dataDir)
    const first = { ...record(1_000, 0.25), sessionId: 'long-session', sourceEventSeq: 1 }
    expect(storage.add(first)?.calls).toBe(1)
    for (let seq = 2; seq <= 2_100; seq++) {
      expect(storage.add({ ...record(seq * 1_000, 0.01), sessionId: 'long-session', sourceEventSeq: seq })).toBeDefined()
    }
    expect(storage.add(first)).toBeUndefined()
    expect(storage.get('long-session')?.calls).toBe(2_100)
  }, 30_000)
})
