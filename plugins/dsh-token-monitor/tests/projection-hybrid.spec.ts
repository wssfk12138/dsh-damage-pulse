/**
 * tokenCost projection 旧/新宿主 hybrid 形态的定向回归（实装旧宿主适配版）：
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
import type { UsageRecord } from '../src/types.ts'
import { createTokenCostProjectionDefinition } from '../src/projection.ts'

/** 直接构造 session 事件现场，不依赖 SessionStore 及其 peer 插件。 */
function makeSession(): Session {
  const events: SessionEvent[] = []
  return {
    id: 's1',
    seq: 0,
    events,
    snapshotEvents: (fromSeq = 0, toSeqExclusive = events.length) =>
      events.slice(Number(fromSeq), Number(toSeqExclusive)),
  } as unknown as Session
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

const frozenRecord = (time: number, seq: number, overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  sessionId: 's1', turn: 1, step: seq + 1, sourceEventSeq: seq, timestamp: time,
  provider: OFFICIAL_PROVIDER_ID, model: 'deepseek-v4-flash', inputTokens: 10,
  cacheReadTokens: 5, cacheWriteTokens: 3, outputTokens: 20, reasoningTokens: 0,
  costInput: 0.00002, costCacheRead: 0.00002, costCacheWrite: 0.000006,
  costCache: 0.000026, costOutput: 0.00016, cost: 0.000206, peak: true,
  billingStatus: 'priced', billingRuleVersion: 1, modelMultiplier: 1, ...overrides,
})

async function harness(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  return { ctx, session: makeSession() }
}

describe('tokenCost hybrid projection compatibility', () => {
  it('folds only frozen token usage records and preserves their stored cost', () => {
    const def = createTokenCostProjectionDefinition(PRICE_TABLE)
    const record = { sessionId: 's1', turn: 1, step: 1, sourceEventSeq: 0, timestamp: 1786953600000, provider: OFFICIAL_PROVIDER_ID, model: 'deepseek-v4-flash', inputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 3, outputTokens: 20, reasoningTokens: 7, costInput: 0.00002, costCacheRead: 0.00002, costCacheWrite: 0.000006, costOutput: 0.00016, costCache: 0.000026, cost: 0.000206, peak: true, billingStatus: 'priced' as const, billingRuleVersion: 4, modelMultiplier: 2 }
    const event = { type: 'token-usage/record', seq: 0, time: record.timestamp, data: { record } } as unknown as SessionEvent
    const state = def.apply(def.init(), event)
    expect(def.view(state)).toMatchObject({ calls: 1, inputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 3, outputTokens: 20, cost: record.cost })
    expect(def.apply(state, { type: 'assistant/message', seq: 1, time: record.timestamp + 1, data: {} } as unknown as SessionEvent)).toEqual(state)
  })
  it('exposes both host-generation field sets from one definition', () => {
    const def = createTokenCostProjectionDefinition(PRICE_TABLE)
    expect(def.key).toBe('tokenCost')
    expect(def.stateVersion).toBe(7)
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
    emit(ctx, session, 'token-usage/record', { record: frozenRecord(t1, 0) }, t1)
    emit(ctx, session, 'token-usage/record', { record: frozenRecord(t2, 1, { cost: 0.000412, costInput: 0.00004, costCacheRead: 0.00004, costCacheWrite: 0.000012, costCache: 0.000052, costOutput: 0.00032 }) }, t2)

    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.asOfSeq).toBe(1)
    expect(snapshot.values.tokenCost).toEqual({
      calls: 2,
      inputTokens: 20,
      cacheReadTokens: 10,
      cacheWriteTokens: 6,
      outputTokens: 40,
      totalTokens: 76,
      cost: 0.000618,
      lastActivity: t2,
    })

    const checkpoint = ctx.sessionProjections.checkpoint(session)
    expect(checkpoint.tokenCost!.ver).toBe(7)
    expect(checkpoint.tokenCost!.seq).toBe(1)
    expect(checkpoint.tokenCost!.val).toMatchObject({ calls: 2, cost: 0.000618 })
    // 持久化的是 fold 态：不得混入派生的 totalTokens
    expect('totalTokens' in (checkpoint.tokenCost!.val as Record<string, unknown>)).toBe(false)

    // restore：同一 checkpoint + 全量日志 → 服务一致的 cut
    const restored = ctx.sessionProjections.restore(checkpoint, session.events as SessionEvent[], 0)
    expect(restored.snapshot.values.tokenCost).toEqual(snapshot.values.tokenCost)
    expect(restored.checkpoint.tokenCost).toEqual({ ver: 7, seq: 1, val: checkpoint.tokenCost!.val })

    // viewCheckpoint：版本匹配的行直接出值；版本不匹配的行缺席
    const viewed = ctx.sessionProjections.viewCheckpoint(checkpoint)
    expect(viewed.tokenCost).toEqual(snapshot.values.tokenCost)
    expect(ctx.sessionProjections.viewCheckpoint({ tokenCost: { ver: 99, seq: 2, val: checkpoint.tokenCost!.val } })).toEqual({})
  })

  it('rebuilds a zero-valued v5 checkpoint instead of trusting the stale row', async () => {
    const { ctx, session } = await harness()
    const def = createTokenCostProjectionDefinition(PRICE_TABLE)
    ctx.sessionProjections.register(def)
    const t = Date.UTC(2026, 7, 17, 2, 0, 0)
    const first = frozenRecord(t, 0)
    const second = frozenRecord(t + 1, 1)
    const events = [
      { type: 'token-usage/record', seq: 0, time: t, data: { record: first } },
      { type: 'token-usage/record', seq: 1, time: t + 1, data: { record: second } },
    ] as unknown as SessionEvent[]
    const stale = {
      tokenCost: { ver: 5, seq: 1, val: def.init() },
    }

    const restored = ctx.sessionProjections.restore(stale, events, 0)
    expect(restored.snapshot.values.tokenCost).toMatchObject({ calls: 2, cost: first.cost + second.cost })
    expect(restored.checkpoint.tokenCost?.ver).toBe(7)
    expect(restored.checkpoint.tokenCost?.seq).toBe(1)
    // 直接 fold 入口同样必须认这种拼写
    const direct = def.apply(def.init(), events[0]!)
    expect(def.view(direct)).toMatchObject({ calls: 1, cost: first.cost })
    expect(def.apply(def.init(), { type: 'assistant/message', seq: 0, time: first.timestamp, data: {} } as unknown as SessionEvent)).toEqual(def.init())
  })

  it('folds the namespaced event name the host returns for pre-current-format logs', async () => {
    const { ctx } = await harness()
    const def = createTokenCostProjectionDefinition(PRICE_TABLE)
    ctx.sessionProjections.register(def)
    const t = Date.UTC(2026, 7, 17, 2, 0, 0)
    const first = frozenRecord(t, 0)
    const second = frozenRecord(t + 1, 1)
    // 旧代际日志读回时，宿主把插件自有的可忽略事件改名为「plugin:原名」；
    // 载荷不变，因此同一份记录必须照样入账。
    const events = [
      { type: 'plugin:token-usage/record', seq: 0, time: t, data: { record: first } },
      { type: 'plugin:token-usage/record', seq: 1, time: t + 1, data: { record: second } },
    ] as unknown as SessionEvent[]
    const stale = { tokenCost: { ver: 6, seq: 1, val: def.init() } }

    const restored = ctx.sessionProjections.restore(stale, events, 0)
    expect(restored.snapshot.values.tokenCost).toMatchObject({ calls: 2, cost: first.cost + second.cost })
    expect(restored.checkpoint.tokenCost?.ver).toBe(7)
    expect(restored.checkpoint.tokenCost?.seq).toBe(1)
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
    emit(ctx, session, 'token-usage/record', { record: frozenRecord(t1, 1) }, t1)

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
      ({ type: 'token-usage/record', seq, time, data: { record: frozenRecord(time, seq, data as Partial<UsageRecord>) } }) as unknown as SessionEvent

    let state = def.init()
    state = def.apply(state, asEvent(0, t1, {}))
    state = def.apply(state, asEvent(1, t1, {}))
    state = def.apply(state, asEvent(2, t2, {}))

    // 旧 registry 的 snapshot / 变更流均走 schema.parse(view(state))：hybrid 必须可解析，
    // 且产出与新宿主 wire 完全一致。
    const value = def.schema.parse(def.view(state))
    expect(value.calls).toBe(3)
    expect(value.totalTokens).toBe(114)
    expect(value).toEqual(def.wire.viewSchema.parse(def.wire.view(state)))
  })

  it('old host ignores the extra stateSchema and still serves schema/view', async () => {
    const { ctx, session } = await harness()
    const def = createTokenCostProjectionDefinition(PRICE_TABLE)
    ctx.sessionProjections.register(def)
    emit(ctx, session, 'token-usage/record', { record: frozenRecord(Date.UTC(2026, 7, 17, 2, 0, 0), 0) }, Date.UTC(2026, 7, 17, 2, 0, 0))
    const checkpoint = ctx.sessionProjections.checkpoint(session)

    // 旧宿主 registry 只读 schema/view，stateSchema 属于新宿主字段：
    // 携带额外 stateSchema（即使误填为带 totalTokens 的 view schema）必须被忽略，
    // snapshot / viewCheckpoint 仍按 schema.parse(view(foldState)) 正常出值，不跳过、不报错。
    const hybrid = { ...def, stateSchema: def.schema } as typeof def
    expect(hybrid.stateSchema).toBe(def.schema)
    expect(ctx.sessionProjections.viewCheckpoint(checkpoint).tokenCost?.calls).toBe(1)
    expect(ctx.sessionProjections.snapshot(session).values.tokenCost?.calls).toBe(1)
  })

  it('keeps the per-key stateVersion guard across host generations', async () => {
    const { ctx } = await harness()
    const def = createTokenCostProjectionDefinition(PRICE_TABLE)
    ctx.sessionProjections.register(def)
    expect(() => ctx.sessionProjections.register({ ...def, stateVersion: 8 })).toThrow(/already registered at stateVersion 7/)
  })
})
