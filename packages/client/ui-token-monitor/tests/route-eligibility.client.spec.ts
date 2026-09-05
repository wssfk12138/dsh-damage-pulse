// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRouteEligibilityLoader, isRouteEligible, matchesPricedModel,
  type ModelDirectoryResolverLike,
  type ModelDirectoryStateLike,
  type PricingEligibilityInfo,
} from '../src/client/routeEligibility.ts'
import { useRouteEligibility } from '../src/client/useRouteEligibility.ts'

const pricing: PricingEligibilityInfo = {
  provider: 'deepseek-official',
  models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  updatedAt: 1,
}

function route(
  provider: string,
  model: string,
  routable: boolean | null = true,
): ModelDirectoryStateLike {
  return { current: { provider, model }, routable }
}

function directories(load: () => Promise<ModelDirectoryStateLike>): ModelDirectoryResolverLike {
  return { directoryFor: vi.fn(() => ({ load })) }
}

function pricedResponse(value: unknown = pricing): Response {
  return new Response(JSON.stringify(value), { status: 200 })
}

describe('route eligibility', () => {
  afterEach(() => { vi.useRealTimers() })

  it('rechecks same-session model changes and recovers without overlapping work', async () => {
    vi.useFakeTimers()
    let settle!: (value: boolean) => void
    const pending = new Promise<boolean>(resolve => { settle = resolve })
    const load = vi.fn().mockResolvedValueOnce(false).mockReturnValueOnce(pending).mockResolvedValue(true)
    const useSessions = (select: (state: { current: string }) => unknown) => select({ current: 's' })
    const hook = renderHook(() => useRouteEligibility(useSessions as never, load, false))
    await act(async () => {})
    expect(hook.result.current).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(load).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(load).toHaveBeenCalledTimes(2)
    await act(async () => { settle(true); await pending })
    expect(hook.result.current).toBe(true)
    hook.unmount()
    expect(load.mock.calls[1]?.[1]?.aborted).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('automatically retries a failed first eligibility request', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(false)
    const useSessions = (select: (state: { current: string }) => unknown) => select({ current: 's' })
    const hook = renderHook(() => useRouteEligibility(useSessions as never, load, false))
    await act(async () => {})
    expect(hook.result.current).toBeUndefined()
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(hook.result.current).toBe(false)
    hook.unmount()
  })

  it('accepts exact and version-suffixed official priced models', () => {
    expect(matchesPricedModel('deepseek-v4-flash', pricing.models)).toBe(true)
    expect(isRouteEligible(
      route('deepseek-official', 'deepseek-v4-flash-20260823'),
      pricing,
    )).toBe(true)
  })

  it('uses the effective projected route exposed by the model directory', async () => {
    const modelDirectories = directories(vi.fn().mockResolvedValue(
      route('deepseek-official', 'deepseek-v4-pro'),
    ))
    const load = createRouteEligibilityLoader(
      modelDirectories,
      vi.fn().mockResolvedValue(pricedResponse()),
    )

    await expect(load('projected-session' as never, new AbortController().signal)).resolves.toBe(true)
    expect(modelDirectories.directoryFor).toHaveBeenCalledWith('projected-session')
  })

  it('uses the effective Host-default route exposed by the model directory', async () => {
    const modelDirectories = directories(vi.fn().mockResolvedValue(
      route('deepseek-official', 'deepseek-v4-flash'),
    ))
    const load = createRouteEligibilityLoader(
      modelDirectories,
      vi.fn().mockResolvedValue(pricedResponse()),
    )

    await expect(load('default-session' as never, new AbortController().signal)).resolves.toBe(true)
  })

  it('returns false only for explicit route or pricing ineligibility', () => {
    expect(isRouteEligible(route('deepseek-official', 'deepseek-v4-flash', false), pricing)).toBe(false)
    expect(isRouteEligible(route('opencodex', 'deepseek-v4-flash'), pricing)).toBe(false)
    expect(isRouteEligible(route('deepseek-official', 'unknown-model'), pricing)).toBe(false)
    expect(isRouteEligible(route('deepseek-official', 'deepseek-v4-flash'), {
      ...pricing,
      provider: 'other-provider',
    })).toBe(false)
  })

  it('keeps unresolved route state indeterminate', () => {
    expect(isRouteEligible({ current: null, routable: true }, pricing)).toBeUndefined()
    expect(isRouteEligible(route('deepseek-official', 'deepseek-v4-pro', null), pricing)).toBeUndefined()
    expect(isRouteEligible(route('deepseek-official', 'deepseek-v4-pro'), undefined)).toBeUndefined()
  })

  it('returns undefined for directory and pricing transport failures', async () => {
    const signal = new AbortController().signal
    await expect(createRouteEligibilityLoader(
      directories(vi.fn().mockRejectedValue(new Error('directory offline'))),
      vi.fn().mockResolvedValue(pricedResponse()),
    )('s' as never, signal)).resolves.toBeUndefined()
    await expect(createRouteEligibilityLoader(
      directories(vi.fn().mockResolvedValue(route('deepseek-official', 'deepseek-v4-pro'))),
      vi.fn().mockResolvedValue(new Response('', { status: 503 })),
    )('s' as never, signal)).resolves.toBeUndefined()
    await expect(createRouteEligibilityLoader(
      directories(vi.fn().mockResolvedValue(route('deepseek-official', 'deepseek-v4-pro'))),
      vi.fn().mockResolvedValue(new Response('{', { status: 200 })),
    )('s' as never, signal)).resolves.toBeUndefined()
    await expect(createRouteEligibilityLoader(
      directories(vi.fn().mockResolvedValue(route('deepseek-official', 'deepseek-v4-pro'))),
      vi.fn().mockResolvedValue(pricedResponse({})),
    )('s' as never, signal)).resolves.toBeUndefined()
    await expect(createRouteEligibilityLoader(
      directories(vi.fn().mockResolvedValue(route('deepseek-official', 'deepseek-v4-pro'))),
      vi.fn().mockRejectedValue(new Error('pricing offline')),
    )('s' as never, signal)).resolves.toBeUndefined()
  })

  it('recovers after an initial directory load failure', async () => {
    const directoryLoad = vi.fn()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce(route('deepseek-official', 'deepseek-v4-pro'))
    const load = createRouteEligibilityLoader(
      directories(directoryLoad),
      vi.fn().mockResolvedValue(pricedResponse()),
    )
    const signal = new AbortController().signal

    await expect(load('s' as never, signal)).resolves.toBeUndefined()
    await expect(load('s' as never, signal)).resolves.toBe(true)
  })

  it('passes the supplied AbortSignal to pricing and settles aborted work as undefined', async () => {
    const modelDirectories = directories(vi.fn().mockResolvedValue(
      route('deepseek-official', 'deepseek-v4-pro'),
    ))
    const fetcher = vi.fn().mockResolvedValue(pricedResponse())
    const controller = new AbortController()
    const load = createRouteEligibilityLoader(modelDirectories, fetcher)

    await expect(load('session-1' as never, controller.signal)).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledWith('/api/token-monitor/pricing-eligibility', {
      cache: 'no-store', signal: controller.signal,
    })

    controller.abort()
    await expect(load('session-2' as never, controller.signal)).resolves.toBeUndefined()
  })

  it('does not let an older session result overwrite the latest session', async () => {
    let resolveOld!: (value: boolean | undefined) => void
    const oldResult = new Promise<boolean | undefined>((resolve) => { resolveOld = resolve })
    let current = 'old-session'
    const useSessions = (selector: (state: { current: string; byId: Record<string, never> }) => unknown) =>
      selector({ current, byId: {} })
    const load = vi.fn((sessionId: string) => sessionId === 'old-session'
      ? oldResult
      : Promise.resolve(true))
    const hook = renderHook(() => useRouteEligibility(useSessions as never, load as never, false))

    expect(load).toHaveBeenCalledWith('old-session', expect.any(AbortSignal))
    current = 'new-session'
    hook.rerender()
    await act(async () => {})
    expect(hook.result.current).toBe(true)

    await act(async () => { resolveOld(false); await oldResult })
    expect(hook.result.current).toBe(true)
    hook.unmount()
  })
})
