import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { registerProtectedRoute } from '../src/http-trust.ts'

function response(): ServerResponse & { status: number; body: string } {
  return {
    status: 0,
    body: '',
    writeHead(this: { status: number }, status: number) { this.status = status; return this },
    end(this: { body: string }, value?: string) { this.body = value ?? ''; return this },
  } as unknown as ServerResponse & { status: number; body: string }
}

const request = { headers: { host: '127.0.0.1:3080' } } as IncomingMessage

type RegisteredRoute = {
  auth: string
  handler: (request: IncomingMessage, response: ServerResponse, peer?: { signal: AbortSignal }) => void
}

function mount(connection?: object) {
  const handler = vi.fn()
  const register = vi.fn((_route: RegisteredRoute) => vi.fn())
  const ctx = { connection, webServer: { register } } as unknown as Context
  registerProtectedRoute(ctx, { kind: 'exact', path: '/api/token-monitor/settings', handler })
  return { route: register.mock.calls[0]![0], handler }
}

describe('protected route registration', () => {
  it('serves a caller the legacy connection accepts', () => {
    const requestRejection = vi.fn(() => undefined)
    const { route, handler } = mount({ requestRejection })
    const res = response()
    route.handler(request, res)
    expect(requestRejection).toHaveBeenCalledWith(request)
    expect(handler).toHaveBeenCalledWith(request, res)
    expect(res.status).toBe(0)
  })

  it.each([401, 403] as const)('preserves legacy rejection %s', (rejection) => {
    const { route, handler } = mount({ requestRejection: () => rejection })
    const res = response()
    route.handler(request, res)
    expect(handler).not.toHaveBeenCalled()
    expect(res.status).toBe(rejection)
    expect(res.body).toBe(rejection === 401 ? 'unauthorized' : 'forbidden')
  })

  it('requires Host authentication and accepts a live peer from the newer WebServer', () => {
    const { route, handler } = mount({})
    const res = response()
    expect(route.auth).toBe('required')
    route.handler(request, res, { signal: new AbortController().signal })
    expect(handler).toHaveBeenCalledWith(request, res)
  })

  it('rejects missing and aborted peers without running the route', () => {
    const { route, handler } = mount()
    for (const peer of [undefined, { signal: AbortSignal.abort() }]) {
      const res = response()
      route.handler(request, res, peer)
      expect(res.status).toBe(403)
    }
    expect(handler).not.toHaveBeenCalled()
  })
})
