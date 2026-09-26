/** Actual execution routes, retained through tool waits and cleared on idle. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createRouteGuard } from './http-trust.ts'

/** A route captured from the request header before streaming begins. */
export interface ExecutionRoute { provider: string; model: string }

/** Attach session-local execution routing without consulting next-request selectors. */
export function attachDisplayScope(ctx: Context): Map<string, ExecutionRoute> {
  const routes = new Map<string, ExecutionRoute>()
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type !== 'start') return
    const config = agent.session.requestHeader()?.config
    if (config) routes.set(agent.session.id, { provider: config.provider, model: config.model })
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') routes.delete(agent.session.id)
  })
  ctx.effect(() => () => routes.clear(), 'token-monitor: execution routes')
  return routes
}

/** Expose only the requested session's active route; selectors remain Client-owned. */
export function registerDisplayScopeRoute(ctx: Context, routes: ReadonlyMap<string, ExecutionRoute>): void {
  const guard = createRouteGuard(ctx)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/token-monitor/display-scope',
    handler: (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      const sessionId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('sessionId')
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(sessionId === null ? null : routes.get(sessionId) ?? null))
    },
  }), 'token-monitor: display scope route')
}
