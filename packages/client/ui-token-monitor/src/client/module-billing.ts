/** Optional monetary seats share one disposable registration lifetime. */
import type { ClientContextLike } from './host-contracts.ts'
import { SessionCostBadge } from './SessionCostBadge.tsx'
import { LegacySessionCostBridge } from './LegacySessionCostBridge.tsx'
import { SESSION_HEADER_ACTIONS_SLOT, SESSION_ROW_TRAILING_SLOT } from './sessionCost.ts'

export function activate(ctx: ClientContextLike): () => void {
  const header = ctx.slots.inject(SESSION_HEADER_ACTIONS_SLOT, () => ctx.slots.register({
    name: SESSION_HEADER_ACTIONS_SLOT,
    id: 'token-monitor-session-cost',
    order: -5,
    locale: 'token-monitor.details',
  }, SessionCostBadge))
  const badge = ctx.slots.inject(SESSION_ROW_TRAILING_SLOT, () => ctx.slots.register({ name: SESSION_ROW_TRAILING_SLOT, locale: 'token-monitor.details' }, SessionCostBadge))
  const bridge = ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'token-monitor-legacy-session-cost', order: 999, locale: 'token-monitor.details' }, LegacySessionCostBridge))
  return () => { bridge(); badge(); header() }
}
