import { useEffect, useRef, useState } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { RouteEligibilityLoader } from './routeEligibility.ts'
import type { SessionListStateLike } from './host-contracts.ts'

/** Current-session route visibility with abort + generation guards against stale settlements. */
export function useRouteEligibility(
  useSessions: SnapshotSelectorHook<SessionListStateLike>,
  load: RouteEligibilityLoader | undefined,
  bypass: boolean,
): boolean | undefined {
  const sessionId = useSessions(snapshot => snapshot.current)
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
    void load(sessionId, controller.signal).then((next) => {
      if (!controller.signal.aborted && generation.current === currentGeneration) setEligible(next)
    }, () => {
      if (!controller.signal.aborted && generation.current === currentGeneration) setEligible(false)
    })
    return () => controller.abort()
  }, [bypass, load, sessionId])

  return eligible
}
