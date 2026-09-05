// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BalanceWidget } from '../src/client/BalanceWidget.tsx'

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.restoreAllMocks()
})

describe('BalanceWidget route gate', () => {
  it('stops polling Token Monitor endpoints after the current route is explicitly ineligible', async () => {
    vi.useFakeTimers()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }))
    let resolveEligibility!: (eligible: false) => void
    const eligibility = new Promise<false>((resolve) => { resolveEligibility = resolve })
    const loadRouteEligibility = vi.fn().mockReturnValue(eligibility)
    const useSessions = (selector: (state: { current: string }) => unknown) => selector({ current: 'session-1' })

    const props = { useSessions, loadRouteEligibility } as unknown as ComponentProps<typeof BalanceWidget>
    const view = render(<BalanceWidget {...props} />)

    expect(loadRouteEligibility).toHaveBeenCalledTimes(1)
    await act(async () => {})
    expect(fetcher).toHaveBeenCalled()

    await act(async () => { resolveEligibility(false); await eligibility })
    expect(view.container.childElementCount).toBe(0)
    fetcher.mockClear()

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
