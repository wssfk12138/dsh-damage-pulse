import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { NotificationEventBuffer } from './notification-events.ts'
import { createRouteGuard } from './http-trust.ts'

export const TOKEN_MONITOR_NOTIFICATION_EVENTS_PATH = '/api/token-monitor/notification-events'

interface NotificationRouteError {
  error: {
    code: 'INVALID_SINCE' | 'METHOD_NOT_ALLOWED'
    message: string
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

function routeError(code: NotificationRouteError['error']['code'], message: string): NotificationRouteError {
  return { error: { code, message } }
}

function parseSince(request: IncomingMessage): number | undefined {
  const value = new URL(request.url ?? TOKEN_MONITOR_NOTIFICATION_EVENTS_PATH, 'http://localhost').searchParams.get('since')
  if (value === null) return 0
  if (!/^(0|[1-9]\d*)$/.test(value)) return undefined
  const since = Number(value)
  return Number.isSafeInteger(since) ? since : undefined
}

export function createNotificationEventsRouteHandler(buffer: NotificationEventBuffer) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      writeJson(
        response,
        405,
        routeError('METHOD_NOT_ALLOWED', 'Only GET and HEAD are supported'),
        { Allow: 'GET, HEAD' },
      )
      return
    }

    const since = parseSince(request)
    if (since === undefined) {
      writeJson(response, 400, routeError('INVALID_SINCE', 'since must be a non-negative safe integer'))
      return
    }

    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(method === 'HEAD' ? undefined : JSON.stringify(buffer.batchSince(since)))
  }
}

/** Register the Host-owned notification stream used by the whale bubble client. */
export function registerNotificationEventsRoute(ctx: Context, buffer: NotificationEventBuffer): void {
  const guard = createRouteGuard(ctx)
  const handler = createNotificationEventsRouteHandler(buffer)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: TOKEN_MONITOR_NOTIFICATION_EVENTS_PATH,
    handler: (request, response) => {
      if (!guard(request, response)) return
      handler(request, response)
    },
  }), 'token-monitor: notification events route')
}
