/** Optional overview seats are registered only while their payload is installed. */
import type { ClientContextLike } from './host-contracts.ts'
import type { createModuleState } from './moduleApi.ts'
import { UsageNodeView } from './UsageNodeView.tsx'
import { SessionStatsBar } from './SessionStatsBar.tsx'
import { tokenUsageNodeDefinition } from './usage-node.ts'

export function activate(ctx: ClientContextLike, modules: ReturnType<typeof createModuleState>): () => void {
  const dispose: Array<() => void> = []
  const inject = () => ({ hooks: { modules } })
  // 0.1.7 把节点注册表改名为 uiConversation.events；更早的宿主仍用顶层的 conversationEvents。
  const events = ctx.get('uiConversation', false)?.events ?? ctx.get('conversationEvents', false)
  if (events) {
    const remove = events.register(tokenUsageNodeDefinition)
    if (typeof remove === 'function') dispose.push(remove as () => void)
    dispose.push(ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'token-usage', inject }, UsageNodeView)))
  }
  dispose.push(ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'token-monitor-stats', order: 0, inject }, SessionStatsBar)))
  return () => { for (const remove of dispose.reverse()) remove() }
}
