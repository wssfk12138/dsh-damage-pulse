/**
 * 单次用量行的 Conversation Node Definition：把 Host 追加的
 * `token-usage/record` 事件组装成对话流内的一行业务行。
 * @module @deepseek-ai/dsh-client-ui-token-monitor/client
 */

import type { TokenUsageRecord } from './types.ts'
import type {
  ConversationLocationLike,
  ConversationNodeContextLike,
  ConversationNodeDefinitionLike,
} from './host-contracts.ts'

/** 单事件即完整 checkpoint，故 Definition 内部 state 就是记录本身。 */
type TokenUsageState = TokenUsageRecord

function locationOf(context: ConversationNodeContextLike): ConversationLocationLike {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

export const tokenUsageNodeDefinition: ConversationNodeDefinitionLike<TokenUsageState> = {
  kind: 'token-usage',
  target: 'chat',
  match: (event) => {
    if (event.type === 'token-usage/record') {
      return { id: String(event.seq), role: 'start' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'token-usage/record') throw new Error('token-usage requires token-usage/record')
    const record = match.event.data.record
    if (record === undefined) throw new Error('token-usage event is missing its record')
    return record
  },
  update: (context) => context.state,
  publication: () => 'immediate',
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'token-usage',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: context.state,
    }
  },
}
