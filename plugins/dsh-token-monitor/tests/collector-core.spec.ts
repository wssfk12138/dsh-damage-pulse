import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { attachUsageCollector } from '../src/collector-core.ts'
import { ModuleWork } from '../src/module-work.ts'
import type { UsageRecord } from '../src/types.ts'

const append = (session: ReturnType<Context['sessions']['create']>, turn: number) => session.append('assistant/message', {
  stream: [], turn, step: 1,
  message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'ok' }], source: { kind: 'model', provider: 'provider', model: 'model' } }),
  usage: { inputTokens: 100, outputTokens: 20 },
}, { surfaceOp: 'append' })

describe('permanent usage capture lifetime', () => {
  it('continues unpriced after optional billing disposal and stops after core disposal', async () => {
    const ctx = new Context()
    const sessions = ctx.plugin(SessionStore)
    await sessions
    const storage = { add: vi.fn(record => record) }
    const observer = vi.fn()
    let price: ((record: UsageRecord) => UsageRecord) | undefined
    const billing = ctx.plugin({ apply(scope: Context) {
      scope.effect(() => {
        price = record => ({ ...record, cost: 1, costInput: 1, billingStatus: 'priced' })
        return () => { price = undefined }
      })
    } })
    await billing
    const core = ctx.plugin({ apply(scope: Context) {
      attachUsageCollector(scope, storage as never, { priceRecord: (record) => price?.(record) ?? record, onPersistedRecord: observer })
    } })
    await core
    const session = ctx.sessions.create()
    append(session, 1)
    await Promise.resolve()
    await billing.dispose()
    append(session, 2)
    await Promise.resolve()
    expect(storage.add.mock.calls.map(([record]) => [record.cost, record.billingStatus])).toEqual([[1, 'priced'], [0, 'unpriced']])
    expect(observer).toHaveBeenCalledTimes(2)
    await core.dispose()
    append(session, 3)
    await Promise.resolve()
    expect(storage.add).toHaveBeenCalledTimes(2)
    await sessions.dispose()
  })

  it('waits for admitted module operations and refuses new ones during teardown', async () => {
    const work = new ModuleWork()
    let finish!: () => void
    const operation = work.run(() => new Promise<void>(resolve => { finish = resolve }))
    let stopped = false
    const stopping = work.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    const late = vi.fn(async () => {})
    await expect(work.run(late)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(late).not.toHaveBeenCalled()
    finish()
    await operation
    await stopping
    expect(stopped).toBe(true)
  })
})
