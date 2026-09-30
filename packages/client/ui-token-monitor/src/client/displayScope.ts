import type { SessionId } from './host-contracts.ts'
import type { ModelDirectoryResolverLike } from './routeEligibility.ts'

/** One foreground card identity. Execution takes precedence over the next-request selector. */
export interface DisplayScope { sessionId?: SessionId; provider: string; model: string }
export type DisplayScopeLoader = (sessionId: SessionId | undefined, signal: AbortSignal) => Promise<DisplayScope | undefined>

function route(value: unknown): { provider: string; model: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  return typeof item.provider === 'string' && item.provider.length > 0 && typeof item.model === 'string' && item.model.length > 0
    ? { provider: item.provider, model: item.model } : undefined
}

/** Resolve actual execution first; idle/new sessions use their selector or the Host default. */
export function createDisplayScopeLoader(
  directories: ModelDirectoryResolverLike,
  loadCatalog: () => Promise<{ default?: unknown }>,
  fetcher: typeof fetch = fetch,
): DisplayScopeLoader {
  return async (sessionId, signal) => {
    if (signal.aborted) return undefined
    if (sessionId !== undefined) {
      const response = await fetcher(`/api/token-monitor/modules/display-scope?${new URLSearchParams({ sessionId })}`, { signal, cache: 'no-store' })
      if (response.status === 204) return undefined
      if (!response.ok) throw new Error('Execution route unavailable')
      const active = await response.json() as unknown
      if (signal.aborted) return undefined
      if (active !== null) {
        const executing = route(active)
        if (!executing) throw new Error('Invalid execution route')
        return { sessionId, ...executing }
      }
      const selected = route((await directories.directoryFor(sessionId).load()).current)
      return signal.aborted || !selected ? undefined : { sessionId, ...selected }
    }
    const selected = route((await loadCatalog()).default)
    return signal.aborted ? undefined : selected
  }
}

/** Stable scope key also prevents stale data from being painted on a newly selected session. */
export function displayScopeKey(scope: DisplayScope | undefined): string {
  return scope ? JSON.stringify([scope.sessionId ?? '', scope.provider, scope.model]) : ''
}
