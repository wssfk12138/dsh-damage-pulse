import { useEffect, useRef, useState } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { RouteEligibilityLoader } from './routeEligibility.ts'
import { activeSessionId, type SessionListStateLike } from './host-contracts.ts'

/**
 * Current-session route visibility with abort + generation guards against stale settlements.
 * @param useSessions - Host snapshot-selector hook for session-list state.
 * @param load - Eligibility loader, or undefined when the Host capability is unavailable.
 * @param bypass - Whether to force visibility without route checks.
 * @returns Current eligibility, or undefined while no definitive decision is available.
 */
export function useRouteEligibility(
  useSessions: SnapshotSelectorHook<SessionListStateLike>,
  load: RouteEligibilityLoader | undefined,
  bypass: boolean,
): boolean | undefined {
  const sessionId = useSessions(snapshot => activeSessionId(snapshot))
  const generation = useRef(0)
  const [eligible, setEligible] = useState<boolean | undefined>(bypass ? true : undefined)

  useEffect(() => {
    const currentGeneration = ++generation.current
    if (bypass) {
      setEligible(true)
      return
    }
    setEligible(undefined)
    if (sessionId === undefined || load === undefined) return

    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    // Recheck same-session model changes and transient failures without overlapping requests.
    const refresh = async () => {
      try {
        const next = await load(sessionId, controller.signal)
        if (!controller.signal.aborted && generation.current === currentGeneration) setEligible(next)
      } catch {
        if (!controller.signal.aborted && generation.current === currentGeneration) setEligible(undefined)
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void refresh() }, 5_000)
      }
    }
    void refresh()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [bypass, load, sessionId])

  return eligible
}
