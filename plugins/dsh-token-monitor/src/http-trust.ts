/** Require the Host's request admission for every route carrying plugin data. */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'

interface LegacyConnection {
  requestRejection?(request: IncomingMessage): 401 | 403 | undefined
}

interface AuthenticatedPeer {
  readonly signal: AbortSignal
}

function legacyConnection(ctx: Context): LegacyConnection | undefined {
  // Cordis may reject reads of services not injected into this context.
  try {
    return Reflect.get(ctx, 'connection') as LegacyConnection | undefined
  } catch {
    return undefined
  }
}

export function registerProtectedRoute(ctx: Context, route: WebRoute): () => void {
  const protectedRoute: WebRoute & { auth: 'required' } = {
    ...route,
    auth: 'required',
    handler: (request: IncomingMessage, response: ServerResponse, peer?: AuthenticatedPeer) => {
      // Older hosts leave admission to the handler. New hosts supply a live peer
      // only after their WebServer has checked the source and credentials.
      const connection = legacyConnection(ctx)
      const rejection = typeof connection?.requestRejection === 'function'
        ? connection.requestRejection(request)
        : peer?.signal.aborted === false ? undefined : 403
      if (rejection === undefined) return route.handler(request, response)
      response.writeHead(rejection, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(rejection === 401 ? 'unauthorized' : 'forbidden')
    },
  }
  return ctx.webServer.register(protectedRoute)
}
