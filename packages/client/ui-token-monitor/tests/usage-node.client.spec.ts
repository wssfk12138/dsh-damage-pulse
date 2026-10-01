import { describe, expect, it } from 'vitest'
import { tokenUsageNodeDefinition as definition } from '../src/client/usage-node.ts'
import type { ConversationNodeContextLike } from '../src/client/host-contracts.ts'
import type { TokenUsageRecord } from '../src/client/types.ts'

function context(sourceEventSeq: unknown = 2560, eventSeq = 2561): ConversationNodeContextLike<TokenUsageRecord> {
  const record: TokenUsageRecord = {
    sessionId: 'anchor-regression', turn: 1, step: 1, sourceEventSeq: sourceEventSeq as number,
    timestamp: 0, provider: 'deepseek-official', model: 'deepseek-flash',
    inputTokens: 17, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0,
    costInput: 0.068, costCache: 0, costCacheRead: 0, costCacheWrite: 0, costOutput: 0, cost: 0.068, peak: false,
  }
  const match = { event: { type: 'token-usage/record', seq: eventSeq, data: { record } },
    location: { kind: 'step' as const, turn: { turn: 1 }, step: { step: 1 } } }
  return { key: 'token-usage:' + eventSeq, id: String(eventSeq), state: record, start: match, matches: [match] }
}

describe('usage rows describe source messages without becoming later chat content (#27)', () => {
  it('anchors the appended usage row to the settled message while preserving identity and ledger data', () => {
    const ctx = context()
    const node = definition.buildViewNode!(ctx)!
    expect(node.anchorSeq).toBe(2560)
    expect(node).toMatchObject({ key: ctx.key, id: '2561', kind: 'token-usage', target: 'chat', visibility: 'visible' })
    expect(node.data).toBe(ctx.state)
    expect(node.location).toBe(ctx.start!.location)
    expect(definition.match(ctx.start!.event)).toEqual({ id: '2561', role: 'start' })
    expect(ctx.start!.event.seq).toBe(2561)
  })

  it.each([0, 1, 2559, Number.MAX_SAFE_INTEGER])('accepts a nonnegative safe source sequence %s', (seq) => {
    expect(definition.buildViewNode!(context(seq))!.anchorSeq).toBe(seq)
  })

  it.each([null, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2560'])('preserves the legacy anchor for invalid source sequence %s', (seq) => {
    expect(definition.buildViewNode!(context(seq))!.anchorSeq).toBe(2561)
  })

  it('reads legacy records without inventing an originating event', () => {
    const ctx = context()
    delete ctx.state!.sourceEventSeq
    expect(definition.buildViewNode!(ctx)!.anchorSeq).toBe(2561)
    expect(definition.buildViewNode!({ ...ctx, start: undefined })!.anchorSeq).toBe(2561)
    expect(definition.buildViewNode!({ ...ctx, start: undefined, matches: [] })!.anchorSeq).toBe(0)
  })

  it('keeps multiple model calls distinct when replaying a tool-using turn', () => {
    const contexts = [context(100, 102), context(110, 112), context(120, 122)]
    const before = structuredClone(contexts)
    for (let replay = 0; replay < 2; replay++) {
      const nodes = contexts.map(ctx => definition.buildViewNode!(ctx)!)
      expect(nodes.map(node => node.anchorSeq)).toEqual([100, 110, 120])
      expect(nodes.map(node => node.id)).toEqual(['102', '112', '122'])
      expect(nodes.map(node => node.data)).toEqual(contexts.map(ctx => ctx.state))
    }
    expect(contexts).toEqual(before)
  })

  it('publishes no node until a record is available', () => {
    expect(definition.buildViewNode!({ ...context(), state: undefined })).toBeNull()
  })
})
