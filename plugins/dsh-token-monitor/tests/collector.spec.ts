import { describe, expect, it, vi } from 'vitest'
import { attachCollector } from '../src/collector.ts'
import { OFFICIAL_PROVIDER_ID, PRICE_TABLE } from '../src/pricing.ts'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'
import type { BillingSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'

describe('usage collector', () => {
  it('keeps collecting unpriced usage when billing is removed during a request', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const storage = { add: vi.fn(record => record) }
    let enabled = true
    attachCollector(ctx, storage as never, PRICE_TABLE, { pricingEnabled: () => enabled })
    const session = ctx.sessions.create()
    enabled = false
    session.append('assistant/message', {
      stream: [], turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'ok' }],
        source: { kind: 'model', provider: OFFICIAL_PROVIDER_ID, model: 'deepseek-v4-flash' } }),
      usage: { inputTokens: 100, outputTokens: 20 },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(storage.add).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 100, outputTokens: 20, cost: 0, billingStatus: 'unpriced' }))
  })
  it('persists a reloadable informational event after publication without replay charging', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const storage = { add: vi.fn(record => record) }
    attachCollector(ctx, storage as never, PRICE_TABLE)
    const session = ctx.sessions.create()
    session.append('assistant/message', {
      stream: [], turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'ok' }],
        source: { kind: 'model', provider: OFFICIAL_PROVIDER_ID, model: 'deepseek-v4-flash' } }),
      usage: { inputTokens: 100, outputTokens: 20 },
    }, { surfaceOp: 'append' })
    await new Promise<void>(resolve => queueMicrotask(resolve))
    const events = structuredClone(session.snapshotEvents())
    expect(events.at(-1)).toMatchObject({ type: 'token-usage/record', ignorable: true })
    expect(() => validateStoredEvents({ id: session.id } as never, events)).not.toThrow()
    const restored = ctx.sessions.create(SessionId('collector-restored'), { seed: events })
    expect(restored.snapshotEvents().filter(event => event.type === 'token-usage/record')).toHaveLength(1)
    expect(storage.add).toHaveBeenCalledTimes(1)
  })
  it('retains a valid zero-token usage in the ledger', async () => {
    let listener: ((session: unknown, event: unknown) => void) | undefined
    const context = {
      on: vi.fn((_name: string, callback: (session: unknown, event: unknown) => void) => { listener = callback }),
    }
    const storage = { add: vi.fn(record => record) }
    const onPersistedRecord = vi.fn()
    attachCollector(context as never, storage as never, PRICE_TABLE, { onPersistedRecord })

    const append = vi.fn()
    listener?.({ id: 'session-zero', append }, {
      type: 'assistant/message',
      seq: 9,
      time: Date.parse('2026-08-24T02:00:00.000Z'),
      data: {
        turn: 1,
        step: 1,
        message: { source: { kind: 'model', provider: OFFICIAL_PROVIDER_ID, model: 'deepseek-v4-flash' } },
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    })

    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(storage.add).toHaveBeenCalledTimes(1)
    expect(onPersistedRecord).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('freezes prices at request start independently for concurrent sessions', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const context = {
      on: vi.fn((name: string, callback: (...args: unknown[]) => void) => { listeners.set(name, callback) }),
    }
    const records: unknown[] = []
    const storage = { add: vi.fn(record => { records.push(structuredClone(record)); return record }) }
    const billing = (input: number, revision: number): BillingSnapshot => ({
      revision,
      rules: {
        version: 1,
        providers: [{ provider: OFFICIAL_PROVIDER_ID, enabled: true, models: [{
          model: 'deepseek-v4-flash', enabled: true, multiplier: 1, mode: 'fixed',
          fixed: { input, cacheHit: input, output: input },
          peak: { input, cacheHit: input, output: input },
          offPeak: { input, cacheHit: input, output: input }, periods: [],
        }] }],
      },
    })
    let current = billing(1, 1)
    attachCollector(context as never, storage as never, PRICE_TABLE, { readBilling: () => current })
    const event = (seq: number) => ({
      type: 'assistant/message', seq, time: Date.parse('2026-08-24T02:00:00.000Z'),
      data: { turn: 1, step: seq + 1, message: { source: { kind: 'model', provider: OFFICIAL_PROVIDER_ID, model: 'deepseek-v4-flash' } }, usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    })
    const first = { id: 'freeze-session', append: vi.fn() }
    const second = { id: 'background-session', append: vi.fn() }
    listeners.get('agent/assistant-stream')?.({ agent: { session: first }, frame: { type: 'start', turn: 1, step: 2 } })
    current = billing(9, 2)
    listeners.get('agent/assistant-stream')?.({ agent: { session: second }, frame: { type: 'start', turn: 1, step: 3 } })
    current = billing(30, 3)
    listeners.get('session/event')?.(first, event(1))
    listeners.get('agent/assistant-stream')?.({ agent: { session: first }, frame: { type: 'end' } })
    listeners.get('session/event')?.(second, event(2))
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(records).toHaveLength(2)
    expect((records[0] as { cost: number; billingRuleVersion: number }).cost).toBe(1)
    expect((records[0] as { billingRuleVersion: number }).billingRuleVersion).toBe(1)
    expect((records[1] as { cost: number; billingRuleVersion: number }).cost).toBe(9)
    expect((records[1] as { billingRuleVersion: number }).billingRuleVersion).toBe(2)
  })
})
