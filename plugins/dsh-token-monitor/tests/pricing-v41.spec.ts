import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { attachCollector } from '../src/collector.ts'
import { createTokenCostProjectionDefinition } from '../src/projection.ts'
import { FLASH_PRICING_START, OFFICIAL_PROVIDER_ID, PRICE_TABLE, PRE_FLASH_PRICE_TABLE, priceUsage, selectPriceTable } from '../src/pricing.ts'

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

  it.each(['deepseek-v4-pro', 'deepseek-v4-pro-0813'])('keeps %s on the Pro rates after the cancelled 9-14 change', model => {
    expect(bill(model, valley - 1)?.cost).toBe(45.3)
    expect(bill(model, valley)?.cost).toBe(22.65)
    expect(bill(model, peak)?.cost).toBe(45.3)
    expect(bill(model, Date.parse('2026-09-13T12:00:00+08:00'))?.cost).toBe(22.65)
    expect(bill(model, Date.parse('2026-09-15T12:00:00+08:00'))?.cost).toBe(22.65)
  })

  it('keeps historical prices and explicit custom overrides', () => {
    expect(bill('deepseek-v4-flash', FLASH_PRICING_START - 1)?.cost).toBe(15.1)
    expect(bill('deepseek-v4-flash', FLASH_PRICING_START)?.cost).toBe(6.02)
    expect(bill('deepseek-flash', FLASH_PRICING_START - 1)).toBeUndefined()
    expect(bill('deepseek-v4-pro', Date.parse('2026-08-16T12:00:00+08:00'))?.cost).toBe(12.025)
    const custom = { ...PRICE_TABLE, version: 'custom' }
    expect(priceUsage(1_000_000, 0, 0, 0, OFFICIAL_PROVIDER_ID, 'deepseek-v4-pro', valley, custom)?.cost).toBe(4.5)
  })

  it('treats a deep-copied official table as the official table (settings default is a copy)', () => {
    // schemastery 解析 settings 默认值时深拷贝价格表：身份变了、内容没变，
    // 若按对象身份判断，历史分段会被整体跳过。
    const copy = JSON.parse(JSON.stringify(PRICE_TABLE)) as typeof PRICE_TABLE
    expect(copy).not.toBe(PRICE_TABLE)
    const historicalValley = Date.parse('2026-09-09T12:00:00+08:00')
    expect(selectPriceTable(historicalValley, copy)).toBe(PRE_FLASH_PRICE_TABLE)
    expect(priceUsage(1_000_000, 0, 0, 0, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', historicalValley, copy)?.cost).toBe(1.5)
    expect(priceUsage(1_000_000, 0, 0, 0, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', valley, copy)?.cost).toBe(1)
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
      expect(storage.add.mock.calls[index]?.[0]).toMatchObject({ model: event.data.message.source.model, cost: event.data.message.source.model === 'deepseek-v4-pro' ? 22.65 : 6.02, sourceEventSeq: index })
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
      expect(restored.snapshot.values.tokenCost?.cost).toBeCloseTo(40.71, 10)
      expect(restored.checkpoint.tokenCost?.ver).toBe(6)
    } finally {
      await fiber.dispose()
    }
  })
})
