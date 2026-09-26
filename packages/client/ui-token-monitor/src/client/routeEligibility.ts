import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'

/** Host pricing identity used to decide whether the current route can be charged. */
export interface PricingEligibilityInfo {
  provider: string
  models: readonly string[]
  updatedAt: number
}

/** Route visibility decision; undefined means the route could not yet be resolved. */
export type RouteEligibility = boolean | undefined
/** Asynchronous route-eligibility lookup for one session. */
export type RouteEligibilityLoader = (
  sessionId: SessionId,
  signal: AbortSignal,
) => Promise<RouteEligibility>

/** Current routed provider and model state used by eligibility checks. */
export interface ModelDirectoryStateLike {
  current: { provider: string; model: string } | null
  routable: boolean | null
}

/** Session model directory capability used to load the current route. */
export interface ModelDirectoryLike {
  load(): Promise<ModelDirectoryStateLike>
}

/** Resolver that provides the model directory for a session. */
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

/**
 * Mirror Host longest-prefix model matching for the current configured price table.
 * @param model - Current routed model identifier.
 * @param configuredModels - Model prefixes with configured official pricing.
 * @returns True when the model equals or extends a configured priced-model prefix.
 */
export function matchesPricedModel(model: string, configuredModels: readonly string[]): boolean {
  return configuredModels.some(name => model === name || model.startsWith(`${name}-`))
}

/**
 * Explicit incompatibility is false; unavailable or unresolved state remains indeterminate.
 * @param route - Current provider, model, and routability state.
 * @param pricing - Configured official pricing identity, or undefined when unavailable.
 * @returns False for an incompatible route, true for an eligible route, or undefined while unresolved.
 */
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

/**
 * Build the latest-session loader used by the React hook; pricing HTTP honors cancellation.
 * @param modelDirectories - Resolver for per-session model route state.
 * @param fetcher - HTTP implementation used to read the Host endpoint.
 * @returns A cancellable per-session route-eligibility loader.
 */
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
