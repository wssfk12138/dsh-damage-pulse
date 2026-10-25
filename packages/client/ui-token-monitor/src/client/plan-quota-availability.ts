/** Whether a provider actually exposes a plan subscription. */

import { useEffect, useState } from 'react'
import type { PlanQuotaSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'
import { PLAN_QUOTA_URL, parsePlanQuotaSnapshot } from './PlanQuotaPanel.tsx'

/** How long a positive answer is reused before asking again. */
const PLAN_QUOTA_PROBE_TTL_MS = 5 * 60_000

/** Result of the subscription probe. */
export type PlanQuotaAvailability = 'probing' | 'available' | 'unavailable'

interface ProbeResult {
  value: 'available'
  at: number
}

let cached: ProbeResult | undefined
let pending: Promise<Exclude<PlanQuotaAvailability, 'probing'>> | undefined

/** Forget the cached probe result; used by tests and by an explicit refresh. */
export function resetPlanQuotaAvailability(): void {
  cached = undefined
  pending = undefined
}

/** Current wall-clock time, used only to age a cached positive answer. */
function now(): number { return Date.now() }

/**
 * Read the snapshot once and decide whether any provider has plan data.
 * @returns `available` when the Host published at least one provider entry.
 */
async function probe(): Promise<Exclude<PlanQuotaAvailability, 'probing'>> {
  try {
    const response = await fetch(PLAN_QUOTA_URL, { cache: 'no-store' })
    if (!response.ok) return 'unavailable'
    const snapshot: PlanQuotaSnapshot | undefined = parsePlanQuotaSnapshot(await response.json())
    return snapshot !== undefined && snapshot.providers.length > 0 ? 'available' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/**
 * Probe the plan quota endpoint once per window open and cache the answer.
 *
 * The tab must stay hidden for users who never connected a plan subscription,
 * which the Host reports as an empty provider list: a provider only appears once
 * its credential, gateway and subscription all line up.
 * @param enabled - Whether billing is installed and the window is open.
 * @returns The current availability, `probing` until the first answer arrives.
 */
export function usePlanQuotaAvailability(enabled: boolean): PlanQuotaAvailability {
  const [state, setState] = useState<PlanQuotaAvailability>(() => {
    if (!enabled) return 'unavailable'
    if (cached !== undefined && now() - cached.at < PLAN_QUOTA_PROBE_TTL_MS) return cached.value
    return 'probing'
  })
  useEffect(() => {
    if (!enabled) { setState('unavailable'); return }
    if (cached !== undefined && now() - cached.at < PLAN_QUOTA_PROBE_TTL_MS) { setState(cached.value); return }
    let disposed = false
    setState('probing')
    if (pending === undefined) pending = probe()
    void pending.then(value => {
      pending = undefined
      // 只缓存「有套餐」。否定的结论不缓存：用户可能刚买好套餐、刚恢复网络，
      // 或者上一次只是瞬时失败，下一次开窗必须重新问一次才算准确。
      if (value === 'available') cached = { value, at: now() }
      if (!disposed) setState(value)
    })
    return () => { disposed = true }
  }, [enabled])
  return state
}

