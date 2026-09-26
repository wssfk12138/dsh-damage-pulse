import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { currentChargeSeq } from '../plugins/dsh-token-monitor/src/charge.ts'
import { attachCollector } from '../plugins/dsh-token-monitor/src/collector.ts'
import { OFFICIAL_PROVIDER_ID, PRICE_TABLE } from '../plugins/dsh-token-monitor/src/pricing.ts'
import type { UsageStorage } from '../plugins/dsh-token-monitor/src/storage.ts'
import type { UsageRecord } from '../plugins/dsh-token-monitor/src/types.ts'

const EVENT_TIME = Date.UTC(2026, 7, 21, 0, 0, 0)

test('collector persists unpriced usage without charging it, then charges priced usage', async () => {
  let sessionEventListener: ((session: Session, event: SessionEvent) => void) | undefined
  const context = {
    on: (name: string, callback: (...args: any[]) => void) => {
      if (name === 'session/event') sessionEventListener = callback as (session: Session, event: SessionEvent) => void
    },
  } as unknown as Context
  const stored: UsageRecord[] = []
  const storage = {
    add: (record: UsageRecord) => {
      stored.push(record)
      return { sessionId: record.sessionId }
    },
  } as unknown as UsageStorage
  const appended: unknown[] = []
  const session = {
    id: 'session-m0',
    append: (...args: unknown[]) => { appended.push(args) },
  } as unknown as Session
  let eventSeq = 0
  const eventFor = (provider: string, model: string) => ({
    type: 'assistant/message',
    seq: eventSeq++,
    time: EVENT_TIME,
    data: {
      turn: 1,
      step: 1,
      message: { source: { kind: 'model', provider, model } },
      usage: { inputTokens: 1_000, outputTokens: 100 },
    },
  }) as unknown as SessionEvent

  attachCollector(context, storage, PRICE_TABLE)
  assert.ok(sessionEventListener)
  const initialChargeSeq = currentChargeSeq()

  sessionEventListener!(session, eventFor('openai-compatible', 'deepseek-v4-flash'))
  sessionEventListener!(session, eventFor(OFFICIAL_PROVIDER_ID, 'future-deepseek-model'))
  assert.equal(stored.length, 2)
  assert.equal(stored.every(record => record.billingStatus === 'unpriced'), true)
  await new Promise<void>(resolve => queueMicrotask(resolve))
  assert.equal(appended.length, 2)
  assert.equal(currentChargeSeq(), initialChargeSeq)

  sessionEventListener!(session, eventFor(OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash'))
  assert.equal(stored.length, 3)
  await new Promise<void>(resolve => queueMicrotask(resolve))
  assert.equal(appended.length, 3)
  assert.equal(currentChargeSeq(), initialChargeSeq + 1)
})
