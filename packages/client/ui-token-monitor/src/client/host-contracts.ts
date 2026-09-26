/**
 * Minimal browser-host contracts used by this plugin.
 *
 * DSH Desktop 2.0.4 no longer ships the legacy dsh-client-runtime package.
 * Keeping these structural types local prevents a type-only legacy dependency
 * from becoming a required module in the host's client boot graph.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { TokenUsageRecord } from './types.ts'

export type { SessionId }

/** Subset of a Host session summary consumed by Token Monitor. */
export interface SessionSummaryLike {
  id: SessionId
  displayTitle: string
  retainedBy?: unknown
  projectionValues?: unknown
}

/** Subset of the Host session-list snapshot consumed by Token Monitor. */
export interface SessionListStateLike {
  byId: Record<SessionId, SessionSummaryLike>
  /** Legacy DSH hosts exposed the selected session directly. */
  current?: SessionId | undefined
}

export function retainedCount(summary: Pick<SessionSummaryLike, 'retainedBy'>, source = 'mainView'): number {
  const retainedBy = summary.retainedBy
  if (typeof retainedBy !== 'object' || retainedBy === null) return 0
  const value = (retainedBy as Record<string, unknown>)[source]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function activeSessionId(snapshot: { byId: Record<string, SessionSummaryLike>; current?: SessionId }): SessionId | undefined {
  if (snapshot.current !== undefined) return snapshot.current
  return Object.values(snapshot.byId).find(session => retainedCount(session) > 0)?.id
}

/** Conversation locations accepted by the token-usage projection. */
export type ConversationLocationLike =
  | { readonly kind: 'session' }
  | { readonly kind: 'turn'; readonly [key: string]: unknown }
  | { readonly kind: 'step'; readonly [key: string]: unknown }
  | { readonly kind: 'unresolved' }

interface ConversationEventLike {
  readonly type: string
  readonly seq: number
  readonly data: { readonly record?: TokenUsageRecord } & Record<string, unknown>
}

interface ConversationMatchLike {
  readonly event: ConversationEventLike
  readonly location: ConversationLocationLike
}

/** Conversation-node fold context required by the token-usage projection. */
export interface ConversationNodeContextLike<State = unknown> {
  readonly key: string
  readonly id: string
  readonly matches: readonly ConversationMatchLike[]
  readonly start: ConversationMatchLike | undefined
  readonly state: State | undefined
}

/** Conversation-node definition surface required to register the token-usage projection. */
export interface ConversationNodeDefinitionLike<State> {
  readonly kind: string
  readonly target?: string
  match(event: ConversationEventLike): { id: string; role: 'start' | 'update' } | null
  start(context: ConversationNodeContextLike<State>, match: ConversationMatchLike): State
  update(context: ConversationNodeContextLike<State> & { readonly state: State }): State
  publication?(): 'none' | 'animation-frame' | 'immediate'
  buildViewNode?(context: ConversationNodeContextLike<State>): Record<string, unknown> | null
}

interface ConversationRegistryLike {
  register(definition: ConversationNodeDefinitionLike<unknown>): unknown
}

interface SlotsLike {
  inject(name: string, factory: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): unknown
}

/** Client plugin context capabilities used by Token Monitor registration. */
export interface ClientContextLike {
  effect(factory: () => unknown, label?: string): unknown
  get(name: 'connection'): unknown
  get(name: 'conversationEvents', required: false): ConversationRegistryLike | undefined
  get(name: string, required?: boolean): unknown
  slots: SlotsLike
}

/** Host catalog RPC used to match billing rows to currently selectable models. */
export interface ModelCatalogConnectionLike {
  remote: {
    session: {
      modelCatalog: () => Promise<{
        ok: boolean
        value?: {
          default?: { provider: string; model: string }
          groups: readonly { id: string; models: readonly { id: string }[] }[]
          failures: readonly { id: string; name?: string; message: string }[]
        }
      }>
    }
  }
}
