import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'

export interface PricingEligibilityInfo {
  provider: string
  models: readonly string[]
  updatedAt: number
}

export type RouteEligibility = boolean | undefined
export type RouteEligibilityLoader = (
  sessionId: SessionId,
  signal: AbortSignal,
) => Promise<RouteEligibility>

export interface ModelDirectoryStateLike {
  current: { provider: string; model: string } | null
  routable: boolean | null
}

export interface ModelDirectoryLike {
  load(): Promise<ModelDirectoryStateLike>
}

export interface ModelDirectoryResolverLike {
  directoryFor(sessionId: SessionId): ModelDirectoryLike
}
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function parsePricingEligibilityInfo(value: unknown): PricingEligibilityInfo | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const data = value as Record<string, unknown>
  if (typeof data.provider !== 'string'
    || !Array.isArray(data.models)
    || !data.models.every(model => typeof model === 'string' && model.length > 0)
    || !Number.isFinite(data.updatedAt)) return undefined
  return { provider: data.provider, models: data.models, updatedAt: data.updatedAt as number }
}

/** Mirror Host longest-prefix model matching for the current configured price table. */
export function matchesPricedModel(model: string, configuredModels: readonly string[]): boolean {
  return configuredModels.some(name => model === name || model.startsWith(`${name}-`))
}

/** Explicit incompatibility is false; unavailable or unresolved state remains indeterminate. */
export function isRouteEligible(
  route: ModelDirectoryStateLike,
  pricing: PricingEligibilityInfo | undefined,
): RouteEligibility {
  if (route.routable === false) return false
  if (route.routable === null || route.current === null || pricing === undefined) return undefined
  if (pricing.provider !== 'deepseek-official') return false
  const current = route.current
  return current.provider === pricing.provider
    && typeof current.model === 'string'
    && matchesPricedModel(current.model, pricing.models)
}

/** Build the latest-session loader used by the React hook; pricing HTTP honors cancellation. */
export function createRouteEligibilityLoader(
  modelDirectories: ModelDirectoryResolverLike,
  fetcher: FetchLike = fetch,
): RouteEligibilityLoader {
  return async (sessionId, signal) => {
    if (signal.aborted) return undefined
    try {
      const directory = modelDirectories.directoryFor(sessionId)
      if (signal.aborted) return undefined
      const [route, response] = await Promise.all([
        directory.load(),
        fetcher('/api/token-monitor/pricing-eligibility', { cache: 'no-store', signal }),
      ])
      if (signal.aborted || !response.ok) return undefined
      const pricing = parsePricingEligibilityInfo(await response.json())
      if (signal.aborted) return undefined
      return isRouteEligible(route, pricing)
    } catch {
      return undefined
    }
  }
}
