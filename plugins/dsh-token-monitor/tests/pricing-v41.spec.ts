import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { attachCollector } from '../src/collector.ts'
import { createTokenCostProjectionDefinition } from '../src/projection.ts'
import { FLASH_PRICING_START, PRO_FLASH_PRICING_START, OFFICIAL_PROVIDER_ID, PRICE_TABLE, priceUsage } from '../src/pricing.ts'

const valley = Date.parse('2026-09-14T12:00:00+08:00')
const peak = Date.parse('2026-09-14T14:00:00+08:00')
const bill = (model: string, time: number, provider = OFFICIAL_PROVIDER_ID) =>
  priceUsage(1_000_000, 1_000_000, 1_000_000, 1_000_000, provider, model, time)

describe('official V4.1 Flash pricing', () => {
  it.each(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'])('prices %s at both published rates', model => {
    expect(bill(model, valley)).toMatchObject({ costInput: 1, costCacheRead: 0.02, costCacheWrite: 1, costOutput: 4, cost: 6.02, peak: false })
    expect(bill(model, peak)).toMatchObject({ costInput: 2, costCacheRead: 0.04, costCacheWrite: 2, costOutput: 8, cost: 12.04, peak: true })
    expect(bill(model, Date.parse('2026-09-19T10:00:00+08:00'))?.cost).toBe(6.02)
  })

  it.each(['deepseek-v4-pro', 'deepseek-v4-pro-0813'])('switches %s exactly at the Pro routing boundary', model => {
    expect(PRO_FLASH_PRICING_START).toBe(valley)
    expect(bill(model, valley - 1)?.cost).toBe(45.3)
    expect(bill(model, valley)?.cost).toBe(6.02)
    expect(bill(model, peak)?.cost).toBe(12.04)
    expect(bill(model, Date.parse('2026-09-13T12:00:00+08:00'))?.cost).toBe(22.65)
  })

  it('keeps historical prices and explicit custom overrides', () => {
    expect(bill('deepseek-v4-flash', FLASH_PRICING_START - 1)?.cost).toBe(15.1)
    expect(bill('deepseek-v4-flash', FLASH_PRICING_START)?.cost).toBe(6.02)
    expect(bill('deepseek-flash', FLASH_PRICING_START - 1)).toBeUndefined()
    expect(bill('deepseek-v4-pro', Date.parse('2026-08-16T12:00:00+08:00'))?.cost).toBe(12.025)
    const custom = { ...PRICE_TABLE, version: 'custom' }
    expect(priceUsage(1_000_000, 0, 0, 0, OFFICIAL_PROVIDER_ID, 'deepseek-v4-pro', valley, custom)?.cost).toBe(4.5)
  })

  it('still rejects other providers and unregistered models', () => {
    expect(bill('deepseek-flash', peak, 'other-provider')).toBeUndefined()
    expect(bill('deepseek-flashlight', peak)).toBeUndefined()
    expect(bill('deepseek-v4.1-pro', peak)).toBeUndefined()
  })

  it('records new and legacy names once each and rebuilds a v4 projection from usage events', async () => {
    let listener: ((session: unknown, event: unknown) => void) | undefined
    const context = { on: vi.fn((_name, callback) => { listener = callback }) }
    const storage = { add: vi.fn(record => record) }
    const append = vi.fn()
    attachCollector(context as never, storage as never, PRICE_TABLE)
    const events = ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro'].map((model, seq) => ({
      type: 'assistant/message', seq, time: valley,
      data: { turn: 1, step: seq + 1,
        message: { source: { kind: 'model', provider: OFFICIAL_PROVIDER_ID, model } },
        usage: { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000, outputTokens: 1_000_000 },
      },
    }))
    for (const event of events) listener?.({ id: 'v41-pricing', append }, event)
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(storage.add).toHaveBeenCalledTimes(4)
    expect(append).toHaveBeenCalledTimes(4)
    events.forEach((event, index) => {
      expect(storage.add.mock.calls[index]?.[0]).toMatchObject({ model: event.data.message.source.model, cost: 6.02, sourceEventSeq: index })
    })

    const ctx = new Context()
    const fiber = ctx.plugin(SessionProjectionRegistry)
    await fiber
    try {
      const def = createTokenCostProjectionDefinition(PRICE_TABLE)
      ctx.sessionProjections.register(def)
      const obsolete = { tokenCost: { ver: 4, seq: 3, val: { ...def.init(), calls: 1, cost: 999 } } }
      const restored = ctx.sessionProjections.restore(obsolete, events as unknown as SessionEvent[], 0)
      expect(restored.snapshot.values.tokenCost?.calls).toBe(4)
      expect(restored.snapshot.values.tokenCost?.cost).toBeCloseTo(24.08, 10)
      expect(restored.checkpoint.tokenCost?.ver).toBe(5)
    } finally {
      await fiber.dispose()
    }
  })
})
