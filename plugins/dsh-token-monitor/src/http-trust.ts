/**
 * One Host/Origin fence for every Token Monitor route that carries personal data.
 *
 * The composition's connection service owns the policy: its Host/Origin fence
 * defeats DNS rebinding and cross-site calls, and its browser authentication
 * (the login-token cookie) gates every caller. A route that skips this gate can
 * be read — and in the write case changed — by any page whose authority the
 * browser accepts, so every data route asks for a rejection first.
 * @module dsh-token-monitor/http-trust
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-client-connection'

/** Trust surface consumed here; the browser-side connection package owns the type. */
interface TrustConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

function connectionOf(ctx: Context): TrustConnection | undefined {
  // Cordis refuses an undeclared service read, so a composition that never
  // injected this service must look like "unavailable", not like a crash.
  try {
    return Reflect.get(ctx, 'connection') as TrustConnection | undefined
  } catch {
    return undefined
  }
}

/** Answer an untrusted or unauthenticated request; true when it was rejected. */
export type RouteGuard = (request: IncomingMessage, response: ServerResponse) => boolean

/**
 * Build the guard for routes registered by one context.
 * @param ctx Context owning the routes; must expose the composition's connection.
 * @returns Guard returning true when the caller may proceed.
 */
export function createRouteGuard(ctx: Context): RouteGuard {
  return (request, response) => {
    const connection = connectionOf(ctx)
    // A composition without the connection service cannot prove who is calling,
    // so it fails closed instead of serving data to an unverified caller.
    const rejection = connection === undefined ? 403 : connection.requestRejection(request)
    if (rejection === undefined) return true
    response.writeHead(rejection, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(rejection === 401 ? 'unauthorized' : 'forbidden')
    return false
  }
}
