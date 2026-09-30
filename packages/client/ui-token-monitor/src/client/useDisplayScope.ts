import { useEffect, useState } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { activeSessionId, type SessionListStateLike } from './host-contracts.ts'
import { displayScopeKey, type DisplayScope, type DisplayScopeLoader } from './displayScope.ts'

/** Poll without overlap, cancel on foreground changes, and never borrow a background route. */
export function useDisplayScope(
  useSessions: SnapshotSelectorHook<SessionListStateLike>, load: DisplayScopeLoader | undefined, enabled = true,
): DisplayScope | undefined {
  const sessionId = useSessions(snapshot => activeSessionId(snapshot))
  const [resolved, setResolved] = useState<{ sessionId: typeof sessionId; scope: DisplayScope | undefined }>()
  useEffect(() => {
    if (!load || !enabled) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      let scope: DisplayScope | undefined
      try { scope = await load(sessionId, controller.signal) } catch { /* Unknown route must not show another provider's balance. */ }
      if (controller.signal.aborted) return
      setResolved((previous) => {
        const unchanged = previous !== undefined && previous.sessionId === sessionId
          && displayScopeKey(previous.scope) === displayScopeKey(scope)
        return unchanged ? previous : { sessionId, scope }
      })
      timer = setTimeout(() => { void refresh() }, 1000)
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [load, sessionId, enabled])
  return enabled && resolved?.sessionId === sessionId ? resolved?.scope : undefined
}
