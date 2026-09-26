import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { OFFICIAL_PROVIDER_ID, PRICE_TABLE, resolvePricingEligibility } from '../plugins/dsh-token-monitor/src/pricing.ts'
import { UsageStorage } from '../plugins/dsh-token-monitor/src/storage.ts'
import type { UsageRecord } from '../plugins/dsh-token-monitor/src/types.ts'

const EVENT_TIME = Date.UTC(2026, 7, 21, 0, 0, 0)

function record(provider: string, model: string, sessionId: string): UsageRecord {
  return {
    sessionId, turn: 1, step: 1, timestamp: EVENT_TIME, provider, model,
    inputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100,
    sourceEventSeq: sessionId === 'wrong-provider' ? 7 : undefined,
    reasoningTokens: 0, costInput: 0.0015, costCache: 0, costCacheRead: 0,
    costCacheWrite: 0, costOutput: 0.00045, cost: 0.00195, peak: false,
  }
}

test('retains raw unpriced history without rewriting it and rejects duplicate additions', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-token-monitor-m0-'))
  try {
    const eligible = record(OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', 'eligible')
    const wrongProvider = record('openai-compatible', 'deepseek-v4-flash', 'wrong-provider')
    const unknownModel = record(OFFICIAL_PROVIDER_ID, 'future-deepseek-model', 'unknown-model')
    const original = `${JSON.stringify(eligible)}\n${JSON.stringify(wrongProvider)}\n${JSON.stringify(unknownModel)}\n`
    const usagePath = join(dataDir, 'usage.jsonl')
    writeFileSync(usagePath, original, 'utf8')

    const storage = new UsageStorage(
      (item) => resolvePricingEligibility(item.provider, item.model, item.timestamp, PRICE_TABLE) !== undefined,
      dataDir,
    )
    assert.deepEqual(storage.history().map((item) => item.sessionId), ['eligible', 'wrong-provider', 'unknown-model'])
    assert.equal(storage.add(wrongProvider), undefined)
    assert.equal(readFileSync(usagePath, 'utf8'), original)

    const added = record(OFFICIAL_PROVIDER_ID, 'deepseek-v4-pro', 'added')
    assert.ok(storage.add(added))
    assert.deepEqual(storage.history().map((item) => item.sessionId), ['eligible', 'wrong-provider', 'unknown-model', 'added'])
    assert.equal(readFileSync(usagePath, 'utf8'), `${original}${JSON.stringify(added)}\n`)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
