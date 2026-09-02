import { describe, expect, it, vi } from 'vitest'
import {
  createRouteEligibilityLoader, isRouteEligible, matchesPricedModel,
  type PricingEligibilityInfo,
} from '../src/client/routeEligibility.ts'

const pricing: PricingEligibilityInfo = {
  provider: 'deepseek-official',
  models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  updatedAt: 1,
}

function response(provider: string, model: string, routable = true, ok = true): any {
  return ok
    ? { result: { ok: true, value: { current: { provider, model }, routable, groups: [], failures: [] } } }
    : { result: { ok: false, error: { code: 'transport', message: 'offline' } } }
}

describe('route eligibility', () => {
  it('accepts exact and version-suffixed official priced models', () => {
    expect(matchesPricedModel('deepseek-v4-flash', pricing.models)).toBe(true)
    expect(isRouteEligible(response('deepseek-official', 'deepseek-v4-flash-20260823'), pricing)).toBe(true)
  })

  it('hides unofficial, unknown, unroutable, and failed session routes', () => {
    expect(isRouteEligible(response('opencodex', 'deepseek-v4-flash'), pricing)).toBe(false)
    expect(isRouteEligible(response('deepseek-official', 'unknown-model'), pricing)).toBe(false)
    expect(isRouteEligible(response('deepseek-official', 'deepseek-v4-flash', false), pricing)).toBe(false)
    expect(isRouteEligible(response('', '', false, false), pricing)).toBe(false)
  })

  it('passes one AbortSignal to RPC and HTTP and returns true for a valid route', async () => {
    const models = vi.fn().mockResolvedValue(response('deepseek-official', 'deepseek-v4-pro'))
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(pricing), { status: 200 }))
    const controller = new AbortController()
    const load = createRouteEligibilityLoader({ models }, fetcher)

    await expect(load('session-1' as never, controller.signal)).resolves.toBe(true)
    expect(models).toHaveBeenCalledWith({ sessionId: 'session-1' }, controller.signal)
    expect(fetcher).toHaveBeenCalledWith('/api/token-monitor/pricing-eligibility', {
      cache: 'no-store', signal: controller.signal,
    })
  })

  it('uses the Desktop 2.0.4 connection.rpc session.models contract', async () => {
    const rpc = vi.fn().mockResolvedValue({
      ok: true,
      value: { current: { provider: 'deepseek-official', model: 'deepseek-v4-pro' }, routable: true },
    })
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(pricing), { status: 200 }))
    const controller = new AbortController()
    const load = createRouteEligibilityLoader({ rpc: { call: rpc } }, fetcher)

    await expect(load('session-2' as never, controller.signal)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('/api', 'session.models', {
      args: { agentId: 'session-2', request: { sessionId: 'session-2' } },
    }, controller.signal)
  })

  it('fails closed for HTTP errors, invalid JSON shapes, and rejected requests', async () => {
    const sessions = { models: vi.fn().mockResolvedValue(response('deepseek-official', 'deepseek-v4-pro')) }
    const signal = new AbortController().signal
    await expect(createRouteEligibilityLoader(sessions, vi.fn().mockResolvedValue(new Response('', { status: 503 })))('s' as never, signal)).resolves.toBe(false)
    await expect(createRouteEligibilityLoader(sessions, vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))('s' as never, signal)).resolves.toBe(false)
    await expect(createRouteEligibilityLoader({ models: vi.fn().mockRejectedValue(new Error('offline')) }, vi.fn())('s' as never, signal)).resolves.toBe(false)
    await expect(createRouteEligibilityLoader({}, vi.fn().mockResolvedValue(new Response(JSON.stringify(pricing), { status: 200 })))('s' as never, signal)).resolves.toBe(false)
  })
})
