import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'

export interface PricingEligibilityInfo {
  provider: string
  models: readonly string[]
  updatedAt: number
}

export type RouteEligibilityLoader = (sessionId: SessionId, signal: AbortSignal) => Promise<boolean>

export interface SessionModelsResponse {
  result: {
    ok: true
    value: {
      routable: boolean
      current: { provider: string; model: string }
    }
  } | {
    ok: false
    error: unknown
  }
}

export type SessionsModelsApi = {
  models: (request: { sessionId: SessionId }, signal: AbortSignal) => Promise<SessionModelsResponse>
}

export type ConnectionRpcLike = {
  call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<{
    ok: true
    value: unknown
  } | {
    ok: false
    error: unknown
  }>
}

export type ConnectionRouteEligibilityLike = {
  api?: { sessions?: SessionsModelsApi }
  rpc?: ConnectionRpcLike
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

/** Conservative route gate: any missing, failed, unroutable, unofficial, or unknown route is hidden. */
export function isRouteEligible(
  response: SessionModelsResponse,
  pricing: PricingEligibilityInfo | undefined,
): boolean {
  if (pricing === undefined || pricing.provider !== 'deepseek-official') return false
  const result = response.result
  if (!result.ok || result.value.routable !== true) return false
  const current = result.value.current
  return current.provider === pricing.provider
    && typeof current.model === 'string'
    && matchesPricedModel(current.model, pricing.models)
}

/** Build the latest-session loader used by the React hook; both requests share one AbortSignal. */
export function createRouteEligibilityLoader(
  connectionOrSessions: ConnectionRouteEligibilityLike | SessionsModelsApi,
  fetcher: FetchLike = fetch,
): RouteEligibilityLoader {
  return async (sessionId, signal) => {
    try {
      const [models, response] = await Promise.all([
        loadSessionModels(connectionOrSessions, sessionId, signal),
        fetcher('/api/token-monitor/pricing-eligibility', { cache: 'no-store', signal }),
      ])
      if (!response.ok) return false
      return isRouteEligible(models, parsePricingEligibilityInfo(await response.json()))
    } catch {
      return false
    }
  }
}

async function loadSessionModels(
  connectionOrSessions: ConnectionRouteEligibilityLike | SessionsModelsApi,
  sessionId: SessionId,
  signal: AbortSignal,
): Promise<SessionModelsResponse> {
  if ('models' in connectionOrSessions && typeof connectionOrSessions.models === 'function') {
    return connectionOrSessions.models({ sessionId }, signal)
  }

  const rpc = (connectionOrSessions as ConnectionRouteEligibilityLike).rpc
  if (rpc === undefined) throw new Error('session.models is unavailable')
  const result = await rpc.call('/api', 'session.models', {
    args: {
      agentId: sessionId,
      request: { sessionId },
    },
  }, signal)
  return { result } as SessionModelsResponse
}
