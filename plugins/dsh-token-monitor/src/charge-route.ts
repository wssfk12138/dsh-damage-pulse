import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { chargeBatchSince, type ChargeBatch } from './charge.ts'
import { createRouteGuard } from './http-trust.ts'

export const TOKEN_MONITOR_CHARGE_EVENTS_PATH = '/api/token-monitor/charge-events'

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

function parseSince(request: IncomingMessage): number | undefined {
  const value = new URL(request.url ?? TOKEN_MONITOR_CHARGE_EVENTS_PATH, 'http://localhost').searchParams.get('since')
  if (value === null) return 0
  if (!/^(0|[1-9]\d*)$/.test(value)) return undefined
  const since = Number(value)
  return Number.isSafeInteger(since) ? since : undefined
}

export function createChargeEventsRouteHandler(batch: (since: number) => ChargeBatch = chargeBatchSince) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and HEAD are supported' } }, { Allow: 'GET, HEAD' })
      return
    }
    const since = parseSince(request)
    if (since === undefined) {
      writeJson(response, 400, { error: { code: 'INVALID_SINCE', message: 'since must be a non-negative safe integer' } })
      return
    }
    const value = batch(since)
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(method === 'HEAD' ? undefined : JSON.stringify(value))
  }
}

export function registerChargeEventsRoute(ctx: Context, batch: (since: number) => ChargeBatch = chargeBatchSince): void {
  const guard = createRouteGuard(ctx)
  const handler = createChargeEventsRouteHandler(batch)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: TOKEN_MONITOR_CHARGE_EVENTS_PATH, handler: (request, response) => {
    if (!guard(request, response)) return
    handler(request, response)
  } }), 'token-monitor: charge events route')
}
