import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { sessionHeader } from '../plugins/dsh-token-monitor/tests/session-header.ts'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { OFFICIAL_PROVIDER_ID, PRICE_TABLE } from '../plugins/dsh-token-monitor/src/pricing.ts'
import { createTokenCostProjectionDefinition } from '../plugins/dsh-token-monitor/src/projection.ts'
import type { UsageRecord } from '../plugins/dsh-token-monitor/src/types.ts'

const EVENT_TIME = Date.UTC(2026, 7, 21, 0, 0, 0)

test("exposes both DSH projection contracts (0.1.0 schema/view and 0.1.1 stateSchema/wire)", () => {
  const definition = createTokenCostProjectionDefinition(PRICE_TABLE)

  // 0.1.1-rc.1/rc.2 host: stateSchema + wire.
  assert.ok(definition.stateSchema)
  assert.ok(definition.wire)
  assert.ok(definition.wire.viewSchema)
  assert.equal(definition.stateVersion, 7)
  // 0.1.0-rc.6/rc.7/rc.8 host: schema + view, aliasing the same constraints and implementation.
  assert.equal(definition.schema, definition.wire.viewSchema)
  assert.equal(definition.view, definition.wire.view)

  const initialState = definition.stateSchema.parse(definition.init())
  const initialView = definition.wire.viewSchema.parse(definition.wire.view(initialState))

  assert.deepEqual(initialView, {
    calls: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
    lastActivity: 0,
  })
})

test('folds a frozen token usage record into a client-visible tokenCost value', () => {
  const definition = createTokenCostProjectionDefinition(PRICE_TABLE)
  assert.ok(definition.wire)

  const record: UsageRecord = {
    sessionId: 'projection-session', turn: 1, step: 1, sourceEventSeq: 0, timestamp: EVENT_TIME,
    provider: OFFICIAL_PROVIDER_ID, model: 'deepseek-v4-flash', inputTokens: 1_000,
    cacheReadTokens: 500, cacheWriteTokens: 100, outputTokens: 200, reasoningTokens: 0,
    costInput: 0.0015, costCacheRead: 0.0005, costCacheWrite: 0.0001, costCache: 0.0006,
    costOutput: 0.00045, cost: 0.00255, peak: false, billingStatus: 'priced',
  }
  const event = { type: 'token-usage/record', seq: 0, time: EVENT_TIME, data: { record } } as unknown as SessionEvent

  const nextState = definition.apply(definition.init(), event)
  const value = definition.wire.viewSchema.parse(definition.wire.view(nextState))
  assert.deepEqual(value, {
    calls: 1,
    inputTokens: 1_000,
    cacheReadTokens: 500,
    cacheWriteTokens: 100,
    outputTokens: 200,
    totalTokens: 1_800,
    cost: record.cost,
    lastActivity: EVENT_TIME,
  })
})

test('folds valid frozen records even when their billing decision is unpriced', () => {
  const definition = createTokenCostProjectionDefinition(PRICE_TABLE)
  const eventFor = (provider: string, model: string) => ({
    type: 'token-usage/record',
    seq: 0,
    time: EVENT_TIME,
    sourceEventSeqs: [],
    data: {
      turn: 1,
      step: 1,
      record: {
        sessionId: 'ineligible', turn: 1, step: 1, sourceEventSeq: 0, timestamp: EVENT_TIME,
        provider, model, inputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0,
        outputTokens: 200, reasoningTokens: 0, costInput: 0, costCache: 0, costCacheRead: 0,
        costCacheWrite: 0, costOutput: 0, cost: 0, peak: false, billingStatus: 'unpriced',
      },
    },
  }) as unknown as SessionEvent

  const initial = definition.init()
  const unpriced = definition.apply(initial, eventFor('openai-compatible', 'deepseek-v4-flash'))
  assert.equal(unpriced.calls, 1)
  assert.equal(unpriced.inputTokens, 1_000)
  assert.equal(unpriced.cost, 0)
  const unknown = definition.apply(initial, eventFor(OFFICIAL_PROVIDER_ID, 'future-deepseek-model'))
  assert.equal(unknown.calls, 1)
  assert.equal(unknown.outputTokens, 200)
})

test('ignores malformed frozen records without changing projection state', () => {
  const definition = createTokenCostProjectionDefinition(PRICE_TABLE)
  const initial = definition.init()
  const event = {
    type: 'token-usage/record', seq: 0, time: EVENT_TIME, data: { record: { provider: OFFICIAL_PROVIDER_ID } },
  } as unknown as SessionEvent
  assert.deepEqual(definition.apply(initial, event), initial)
})

test('serves tokenCost through the real DSH 0.1.1 projection registry', () => {
  const context = new Context()
  const registry = new SessionProjectionRegistry(context)
  registry.register(createTokenCostProjectionDefinition(PRICE_TABLE))

  const restored = registry.restore({}, [], SessionLogOffset(0), sessionHeader(), SessionLogOffset(0))

  assert.deepEqual(restored.snapshot.values.tokenCost, {
    calls: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
    lastActivity: 0,
  })
  assert.deepEqual(restored.checkpoint.tokenCost?.val, createTokenCostProjectionDefinition(PRICE_TABLE).init())
})

test('regression #10: old 0.1.0 host path def.schema.parse(def.view(state)) survives folds', () => {
  const definition = createTokenCostProjectionDefinition(PRICE_TABLE)
  const event = {
    type: 'token-usage/record',
    seq: 0,
    time: EVENT_TIME,
    sourceEventSeqs: [],
    data: {
      turn: 1,
      step: 1,
      record: {
        sessionId: 'old-host', turn: 1, step: 1, sourceEventSeq: 0, timestamp: EVENT_TIME,
        provider: OFFICIAL_PROVIDER_ID, model: 'deepseek-v4-flash', inputTokens: 1_000,
        cacheReadTokens: 500, cacheWriteTokens: 100, outputTokens: 200, reasoningTokens: 0,
        costInput: 0.0015, costCacheRead: 0.0005, costCacheWrite: 0.0001, costCache: 0.0006,
        costOutput: 0.00045, cost: 0.00255, peak: false, billingStatus: 'priced',
      },
    },
  } as unknown as SessionEvent

  // 0.1.0-rc.6/rc.7/rc.8 宿主读取 schema/view 形态：先 view(state) 再 schema.parse。
  const state = definition.apply(definition.init(), event)
  const parsed = definition.schema.parse(definition.view(state))
  assert.equal(parsed.calls, 1)
  assert.equal(parsed.totalTokens, 1_800)
  assert.ok(parsed.cost > 0)
  assert.equal(parsed.lastActivity, EVENT_TIME)

  // 连续 fold 后旧路径依然可解析，不抛 strict()/schema 崩溃。
  const replayed = definition.apply(definition.apply(state, event), event)
  assert.equal(definition.schema.parse(definition.view(replayed)).calls, 3)
})
