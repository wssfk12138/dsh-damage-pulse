/**
 * Minimal browser-host contracts used by this plugin.
 *
 * DSH Desktop 2.0.4 no longer ships the legacy dsh-client-runtime package.
 * Keeping these structural types local prevents a type-only legacy dependency
 * from becoming a required module in the host's client boot graph.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionCostProjectionLike } from './sessionCost.ts'
import type { TokenUsageRecord } from './types.ts'

export type { SessionId }

export interface SessionSummaryLike {
  id: SessionId
  displayTitle: string
  projectionValues?: SessionCostProjectionLike
}

export interface SessionListStateLike {
  byId: Record<SessionId, SessionSummaryLike>
  current: SessionId | undefined
}

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

export interface ConversationNodeContextLike<State = unknown> {
  readonly key: string
  readonly id: string
  readonly matches: readonly ConversationMatchLike[]
  readonly start: ConversationMatchLike | undefined
  readonly state: State | undefined
}

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
  inject(name: string, factory: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): unknown
}

export interface ClientContextLike {
  get(name: 'connection'): unknown
  get(name: 'conversationEvents', required: false): ConversationRegistryLike | undefined
  get(name: string, required?: boolean): unknown
  slots: SlotsLike
}
