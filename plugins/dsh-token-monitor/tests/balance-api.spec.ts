import type { Context } from '@deepseek-ai/cordis'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { registerBalanceApi } from '../src/balance-api.ts'
import { BalanceEndpointMismatchError, SensitiveBalanceScriptError, type BalanceScriptConfig } from '../src/balance-config.ts'
import type { BalanceRegistry } from '../src/balance-registry.ts'
import { BalanceScriptConflictError } from '../src/balance-storage.ts'

type Handler = (request: IncomingMessage, response: ServerResponse) => Promise<void> | void

function request(method: string, url: string, body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const value = Readable.from(chunks) as unknown as IncomingMessage
  value.method = method
  value.url = url
  value.headers = body === undefined ? {} : { 'content-type': 'application/json' }
  return value
}

function response(): ServerResponse & { status: number; body: string } {
  return {
    status: 0,
    body: '',
    writeHead(this: { status: number }, status: number) { this.status = status; return this },
    end(this: { body: string }, value?: string) { this.body = value ?? ''; return this },
  } as unknown as ServerResponse & { status: number; body: string }
}

function setup(rejection: 401 | 403 | undefined, scripts: Pick<BalanceScriptConfig, 'read' | 'update' | 'approve'>) {
  const routes = new Map<string, Handler>()
  const registry = { get: vi.fn(), invalidate: vi.fn() } as unknown as BalanceRegistry
  const ctx = {
    effect: (register: () => unknown) => register(),
    webServer: { register: vi.fn((route: { path: string; handler: Handler }) => { routes.set(route.path, route.handler); return () => {} }) },
    connection: { requestRejection: vi.fn(() => rejection) },
    llm: { listConfigurableProviders: vi.fn(() => [{ provider: 'fast' }, { provider: 'deepseek-account' }]) },
  } as unknown as Context
  registerBalanceApi(ctx, scripts as BalanceScriptConfig, registry)
  return {
    ctx,
    registry,
    handler: routes.get('/api/token-monitor/balance-script')!,
    endpoint: routes.get('/api/token-monitor/balance-endpoint')!,
  }
}

describe('balance HTTP security boundary', () => {
  it('routes native switch edits, preserves compatibility pauses and rejects ambiguous bodies', async () => {
    const scripts = { read: vi.fn(), approve: vi.fn(), update: vi.fn().mockResolvedValue({ enabled: false }), updateNative: vi.fn().mockResolvedValue({ enabled: false, revision: 2 }) }
    const { handler, registry } = setup(undefined, scripts)
    const url = '/api/token-monitor/balance-script?provider=deepseek-account'
    const accepted = response()
    await handler(request('PUT', url, { enabled: false, expectedRevision: 1 }), accepted)
    expect(accepted.status).toBe(200)
    expect(scripts.updateNative).toHaveBeenCalledWith('deepseek-account', false, 1)
    expect(registry.invalidate).toHaveBeenCalledWith('deepseek-account')
    const compatibility = response()
    await handler(request('PUT', url, { script: '', expectedRevision: 2 }), compatibility)
    expect(compatibility.status).toBe(200)
    expect(scripts.update).toHaveBeenCalledWith('deepseek-account', '', 2)
    for (const body of [{ enabled: false, script: '', expectedRevision: 1 }, { enabled: 'false', expectedRevision: 1 }, { enabled: false, expectedRevision: 1, extra: true }, { expectedRevision: 1 }]) {
      const rejected = response()
      await handler(request('PUT', url, body), rejected)
      expect(rejected.status).toBe(400)
    }
    const nonNative = response()
    await handler(request('PUT', '/api/token-monitor/balance-script?provider=fast', { enabled: false, expectedRevision: 1 }), nonNative)
    expect(nonNative.status).toBe(400)
    expect(scripts.updateNative).toHaveBeenCalledOnce()
  })
  it('rejects unauthorized native writes and reports native conflicts and invalid script edits', async () => {
    const scripts = { read: vi.fn(), approve: vi.fn(), update: vi.fn().mockRejectedValue(new TypeError()), updateNative: vi.fn().mockRejectedValue(new BalanceScriptConflictError()) }
    const url = '/api/token-monitor/balance-script?provider=deepseek-account'
    const denied = response()
    await setup(403, scripts).handler(request('PUT', url, { enabled: true, expectedRevision: 0 }), denied)
    expect(denied.status).toBe(403)
    expect(scripts.updateNative).not.toHaveBeenCalled()
    const { handler, registry } = setup(undefined, scripts)
    const conflict = response()
    await handler(request('PUT', url, { enabled: true, expectedRevision: 0 }), conflict)
    expect(conflict.status).toBe(409)
    const invalid = response()
    await handler(request('PUT', url, { script: 'nonempty', expectedRevision: 0 }), invalid)
    expect(invalid.status).toBe(400)
    expect(registry.invalidate).not.toHaveBeenCalled()
  })
  it('rejects unauthenticated requests before reading provider configuration', async () => {
    const scripts = { read: vi.fn(), update: vi.fn() }
    const { ctx, handler } = setup(401, scripts as unknown as BalanceScriptConfig)
    const res = response()
    await handler(request('GET', '/api/token-monitor/balance-script?provider=fast'), res)
    expect(ctx.connection.requestRejection).toHaveBeenCalledOnce()
    expect(res.status).toBe(401)
    expect(res.body).toBe('unauthorized')
    expect(scripts.read).not.toHaveBeenCalled()
  })

  it('returns a fixed error without reflecting credential-bearing source', async () => {
    const secret = 'sk-route-secret-123456'
    const scripts = {
      read: vi.fn(),
      update: vi.fn().mockRejectedValue(new SensitiveBalanceScriptError()),
    }
    const { handler } = setup(undefined, scripts as unknown as BalanceScriptConfig)
    const res = response()
    await handler(request('PUT', '/api/token-monitor/balance-script?provider=fast', {
      script: '({ apiKey: "' + secret + '" })',
      expectedRevision: 1,
    }), res)
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: { code: 'SENSITIVE_SCRIPT' } })
    expect(res.body).not.toContain(secret)
  })

  it('refuses an endpoint approval from an unauthenticated caller', async () => {
    const scripts = { read: vi.fn(), update: vi.fn(), approve: vi.fn() }
    const { endpoint } = setup(401, scripts as unknown as BalanceScriptConfig)
    const res = response()
    await endpoint(request('PUT', '/api/token-monitor/balance-endpoint?provider=fast', { path: '/v1/usage', method: 'GET' }), res)
    expect(res.status).toBe(401)
    expect(scripts.approve).not.toHaveBeenCalled()
  })

  it('approves only the endpoint the saved adapter declares', async () => {
    const scripts = {
      read: vi.fn(), update: vi.fn(),
      approve: vi.fn()
        .mockRejectedValueOnce(new BalanceEndpointMismatchError())
        .mockResolvedValueOnce({ provider: 'fast', revision: 1, script: 'adapter', status: 'valid' }),
    }
    const { registry, endpoint } = setup(undefined, scripts as unknown as BalanceScriptConfig)
    const rejected = response()
    await endpoint(request('PUT', '/api/token-monitor/balance-endpoint?provider=fast', { path: '/v1/other', method: 'GET' }), rejected)
    expect(rejected.status).toBe(400)
    expect(JSON.parse(rejected.body)).toEqual({ error: { code: 'ENDPOINT_NOT_REQUESTED' } })
    expect(registry.invalidate).not.toHaveBeenCalled()

    const accepted = response()
    await endpoint(request('PUT', '/api/token-monitor/balance-endpoint?provider=fast', { path: '/v1/usage', method: 'GET' }), accepted)
    expect(accepted.status).toBe(200)
    expect(JSON.parse(accepted.body)).toMatchObject({ status: 'valid' })
    expect(registry.invalidate).toHaveBeenCalledWith('fast')
  })

  it('validates the approval body before touching stored scripts', async () => {
    const scripts = { read: vi.fn(), update: vi.fn(), approve: vi.fn() }
    const { endpoint } = setup(undefined, scripts as unknown as BalanceScriptConfig)
    for (const body of [{ path: 'https://a.example/x', method: 'GET' }, { path: '/v1/usage', method: 'DELETE' }, { path: '/v1/usage', method: 'GET', extra: 1 }]) {
      const res = response()
      await endpoint(request('PUT', '/api/token-monitor/balance-endpoint?provider=fast', body), res)
      expect(res.status).toBe(400)
      expect(JSON.parse(res.body)).toEqual({ error: { code: 'INVALID_REQUEST' } })
    }
    expect(scripts.approve).not.toHaveBeenCalled()
  })
})
