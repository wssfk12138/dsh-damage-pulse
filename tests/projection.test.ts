import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { OFFICIAL_PROVIDER_ID, PRICE_TABLE, priceUsage } from '../plugins/dsh-token-monitor/src/pricing.ts'
import { createTokenCostProjectionDefinition } from '../plugins/dsh-token-monitor/src/projection.ts'

const EVENT_TIME = Date.UTC(2026, 7, 21, 0, 0, 0)

test("exposes both DSH projection contracts (0.1.0 schema/view and 0.1.1 stateSchema/wire)", () => {
  const definition = createTokenCostProjectionDefinition(PRICE_TABLE)

  // 0.1.1-rc.1/rc.2 host: stateSchema + wire.
  assert.ok(definition.stateSchema)
  assert.ok(definition.wire)
  assert.ok(definition.wire.viewSchema)
  assert.equal(definition.stateVersion, 5)
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

test('folds model usage into a client-visible tokenCost value', () => {
  const definition = createTokenCostProjectionDefinition(PRICE_TABLE)
  assert.ok(definition.wire)

  const event = {
    type: 'assistant/message',
    seq: 0,
    time: EVENT_TIME,
    sourceEventSeqs: [],
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'message-1',
        role: 'assistant',
        content: [],
        source: {
          kind: 'model',
          provider: OFFICIAL_PROVIDER_ID,
          model: 'deepseek-v4-flash',
        },
      },
      usage: {
        inputTokens: 1_000,
        cacheReadTokens: 500,
        cacheWriteTokens: 100,
        outputTokens: 200,
      },
    },
  } as unknown as SessionEvent

  const nextState = definition.apply(definition.init(), event)
  const value = definition.wire.viewSchema.parse(definition.wire.view(nextState))
  const expectedBreakdown = priceUsage(
    1_000, 500, 100, 200, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', EVENT_TIME, PRICE_TABLE,
  )
  assert.ok(expectedBreakdown)

  assert.deepEqual(value, {
    calls: 1,
    inputTokens: 1_000,
    cacheReadTokens: 500,
    cacheWriteTokens: 100,
    outputTokens: 200,
    totalTokens: 1_800,
    cost: expectedBreakdown.cost,
    lastActivity: EVENT_TIME,
  })
})

test('excludes non-official providers and unknown models from the projection', () => {
  const definition = createTokenCostProjectionDefinition(PRICE_TABLE)
  const eventFor = (provider: string, model: string) => ({
    type: 'assistant/message',
    seq: 0,
    time: EVENT_TIME,
    sourceEventSeqs: [],
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'ineligible-message',
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider, model },
      },
      usage: { inputTokens: 1_000, outputTokens: 200 },
    },
  }) as unknown as SessionEvent

  const initial = definition.init()
  assert.deepEqual(definition.apply(initial, eventFor('openai-compatible', 'deepseek-v4-flash')), initial)
  assert.deepEqual(definition.apply(initial, eventFor(OFFICIAL_PROVIDER_ID, 'future-deepseek-model')), initial)
})

test('serves tokenCost through the real DSH 0.1.1 projection registry', () => {
  const context = new Context()
  const registry = new SessionProjectionRegistry(context)
  registry.register(createTokenCostProjectionDefinition(PRICE_TABLE))

  const restored = registry.restore({}, [], 0)

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
    type: 'assistant/message',
    seq: 0,
    time: EVENT_TIME,
    sourceEventSeqs: [],
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'old-host-message',
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: OFFICIAL_PROVIDER_ID, model: 'deepseek-v4-flash' },
      },
      usage: { inputTokens: 1_000, cacheReadTokens: 500, cacheWriteTokens: 100, outputTokens: 200 },
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
