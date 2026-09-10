/**
 * tokenCost projection 旧/新宿主 hybrid 形态的定向回归：
 * 同一份定义同时暴露 0.1.0-rc.6/rc.7/rc.8 的 schema/view 与
 * 0.1.1-rc.1/rc.2 的 stateSchema/wire，确保新宿主 registry
 * （snapshot / checkpoint / restore / viewCheckpoint）与旧宿主契约
 * （schema.parse(view(state))）均可消费同一定义。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { OFFICIAL_PROVIDER_ID, PRICE_TABLE, priceUsage } from '../src/pricing.ts'
import { createTokenCostProjectionDefinition } from '../src/projection.ts'

/** 直接构造 session 事件现场，不依赖 SessionStore 及其 peer 插件。 */
function makeSession(): Session {
  return { id: 's1', seq: 0, events: [] } as unknown as Session
}

/** 向 session 提交一个事件并推入 registry 的 session/event 订阅。 */
function emit(ctx: Context, session: Session, type: string, data: unknown, time: number): SessionEvent {
  const event = { type, seq: session.events.length, time, data } as unknown as SessionEvent
  session.events.push(event)
  ;(session as { seq: number }).seq = event.seq + 1
  void ctx.emit('session/event', session, event)
  return event
}

const eligibleCall = (time: number) => ({
  message: {
    role: 'assistant',
    content: '',
    source: { kind: 'model', provider: OFFICIAL_PROVIDER_ID, model: 'deepseek-v4-flash' },
  },
  usage: { inputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 3, outputTokens: 20 },
})

async function harness(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  return { ctx, session: makeSession() }
}

describe('tokenCost hybrid projection compatibility', () => {
  it('exposes both host-generation field sets from one definition', () => {
    const def = createTokenCostProjectionDefinition(PRICE_TABLE)
    expect(def.key).toBe('tokenCost')
    expect(def.stateVersion).toBe(5)
    // 新宿主（0.1.1+）：stateSchema + wire
    expect(def.stateSchema).toBeDefined()
    expect(def.wire.viewSchema).toBeDefined()
    // 旧宿主（0.1.0-rc.6/rc.7/rc.8）：schema + view —— 与新宿主共用同一对象与实现
    expect(def.schema).toBe(def.wire.viewSchema)
    expect(def.view).toBe(def.wire.view)
    // 两侧对空状态给出同一 wire 值
    const initial = def.init()
    expect(def.schema.parse(def.view(initial))).toEqual(def.wire.viewSchema.parse(def.wire.view(initial)))
  })

  it('serves the new host registry end to end: snapshot / checkpoint / restore / viewCheckpoint', async () => {
    const { ctx, session } = await harness()
    ctx.sessionProjections.register(createTokenCostProjectionDefinition(PRICE_TABLE))

    // 北京时间周一 10:00（高峰）与 16:00（低谷），价格确定且各不相同。
    const t1 = Date.UTC(2026, 7, 17, 2, 0, 0)
    const t2 = Date.UTC(2026, 7, 17, 8, 0, 0)
    emit(ctx, session, 'assistant/message', eligibleCall(t1), t1)
    emit(ctx, session, 'assistant/message', {
      message: { role: 'assistant', content: '', source: { kind: 'model', provider: 'other-provider', model: 'deepseek-v4-flash' } },
      usage: { inputTokens: 999, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 999 },
    }, t1)
    emit(ctx, session, 'assistant/message', eligibleCall(t2), t2)

    const breakdown1 = priceUsage(10, 5, 3, 20, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', t1)
    const breakdown2 = priceUsage(10, 5, 3, 20, OFFICIAL_PROVIDER_ID, 'deepseek-v4-flash', t2)
    expect(breakdown1).toBeDefined()
    expect(breakdown2).toBeDefined()

    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.asOfSeq).toBe(2)
    expect(snapshot.values.tokenCost).toEqual({
      calls: 2,
      inputTokens: 20,
      cacheReadTokens: 10,
      cacheWriteTokens: 6,
      outputTokens: 40,
      totalTokens: 76,
      cost: breakdown1!.cost + breakdown2!.cost,
      lastActivity: t2,
    })

    const checkpoint = ctx.sessionProjections.checkpoint(session)
    expect(checkpoint.tokenCost!.ver).toBe(5)
    expect(checkpoint.tokenCost!.seq).toBe(2)
    expect(checkpoint.tokenCost!.val).toMatchObject({ calls: 2, cost: breakdown1!.cost + breakdown2!.cost })
    // 持久化的是 fold 态：不得混入派生的 totalTokens
    expect('totalTokens' in (checkpoint.tokenCost!.val as Record<string, unknown>)).toBe(false)

    // restore：同一 checkpoint + 全量日志 → 服务一致的 cut
    const restored = ctx.sessionProjections.restore(checkpoint, session.events as SessionEvent[], 0)
    expect(restored.snapshot.values.tokenCost).toEqual(snapshot.values.tokenCost)
    expect(restored.checkpoint.tokenCost).toEqual({ ver: 5, seq: 2, val: checkpoint.tokenCost!.val })

    // viewCheckpoint：版本匹配的行直接出值；版本不匹配的行缺席
    const viewed = ctx.sessionProjections.viewCheckpoint(checkpoint)
    expect(viewed.tokenCost).toEqual(snapshot.values.tokenCost)
    expect(ctx.sessionProjections.viewCheckpoint({ tokenCost: { ver: 99, seq: 2, val: checkpoint.tokenCost!.val } })).toEqual({})
  })

  it('skips ineligible calls with an unchanged state reference on both host contracts', async () => {
    const { ctx, session } = await harness()
    const def = createTokenCostProjectionDefinition(PRICE_TABLE)
    ctx.sessionProjections.register(def)
    const changed: string[] = []
    ctx.sessionProjections.onChanged((_session, key) => {
      changed.push(key)
    })

    const t1 = Date.UTC(2026, 7, 17, 2, 0, 0)
    const ineligible = emit(ctx, session, 'assistant/message', {
      message: { role: 'assistant', content: '', source: { kind: 'model', provider: 'other-provider', model: 'deepseek-v4-flash' } },
      usage: { inputTokens: 999, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 999 },
    }, t1)
    emit(ctx, session, 'assistant/message', eligibleCall(t1), t1)

    // 旧宿主 fold 契约：不合格事件必须返回同一 state 引用（Object.is 零下游工作）
    const initial = def.init()
    expect(def.apply(initial, ineligible)).toBe(initial)
    // 新宿主变更流只通知合格调用
    expect(changed).toEqual(['tokenCost'])
    expect(ctx.sessionProjections.snapshot(session).values.tokenCost?.calls).toBe(1)
  })

  it('consumes the hybrid through the old host contract schema.parse(view(state))', () => {
    const def = createTokenCostProjectionDefinition(PRICE_TABLE)
    const t1 = Date.UTC(2026, 7, 17, 2, 0, 0)
    const t2 = Date.UTC(2026, 7, 17, 8, 0, 0)
    const asEvent = (seq: number, time: number, data: unknown): SessionEvent =>
      ({ type: 'assistant/message', seq, time, data }) as unknown as SessionEvent

    let state = def.init()
    state = def.apply(state, asEvent(0, t1, eligibleCall(t1)))
    state = def.apply(state, asEvent(1, t1, { ...eligibleCall(t1), usage: undefined }))
    state = def.apply(state, asEvent(2, t2, eligibleCall(t2)))

    // 旧 registry 的 snapshot / 变更流均走 schema.parse(view(state))：hybrid 必须可解析，
    // 且产出与新宿主 wire 完全一致。
    const value = def.schema.parse(def.view(state))
    expect(value.calls).toBe(2)
    expect(value.totalTokens).toBe(76)
    expect(value).toEqual(def.wire.viewSchema.parse(def.wire.view(state)))
  })

  it('new-host cold reads reject a view-shaped stateSchema (the two schemas must stay separate)', async () => {
    const { ctx, session } = await harness()
    const def = createTokenCostProjectionDefinition(PRICE_TABLE)
    ctx.sessionProjections.register(def)
    emit(ctx, session, 'assistant/message', eligibleCall(Date.UTC(2026, 7, 17, 2, 0, 0)), Date.UTC(2026, 7, 17, 2, 0, 0))
    const checkpoint = ctx.sessionProjections.checkpoint(session)

    // 误用：把校验 wire 值的 schema（含 totalTokens）当 stateSchema，而 fold 态并不含该字段。
    const misused = { ...def, stateSchema: def.schema } as never
    const broken = new Context()
    await broken.plugin(SessionProjectionRegistry)
    broken.sessionProjections.register(misused)
    // viewCheckpoint 捕获解析失败并跳过该键；restore 的冷读则为无法解析的行整体报错。
    expect('tokenCost' in broken.sessionProjections.viewCheckpoint(checkpoint)).toBe(false)
    expect(() => broken.sessionProjections.restore(checkpoint, session.events as SessionEvent[], 0)).toThrow()
  })

  it('keeps the per-key stateVersion guard across host generations', async () => {
    const { ctx } = await harness()
    const def = createTokenCostProjectionDefinition(PRICE_TABLE)
    ctx.sessionProjections.register(def)
    expect(() => ctx.sessionProjections.register({ ...def, stateVersion: 6 })).toThrow(/already registered at stateVersion 5/)
  })
})
