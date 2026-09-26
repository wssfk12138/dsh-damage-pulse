import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createRouteGuard } from '../src/http-trust.ts'

function response(): ServerResponse & { status: number; body: string } {
  return {
    status: 0,
    body: '',
    writeHead(status: number) { this.status = status; return this },
    end(value?: string) { this.body = value ?? ''; return this },
  } as unknown as ServerResponse & { status: number; body: string }
}

const request = (headers: Record<string, string> = {}): IncomingMessage => ({ headers }) as unknown as IncomingMessage

describe('route trust guard', () => {
  it('serves a caller the connection service accepts', () => {
    const ctx = { connection: { requestRejection: vi.fn(() => undefined) } } as unknown as Context
    const res = response()
    expect(createRouteGuard(ctx)(request({ host: '127.0.0.1:3080' }), res)).toBe(true)
    expect(res.status).toBe(0)
  })

  it('answers 401 and 403 from the connection service without running the route', () => {
    for (const rejection of [401, 403] as const) {
      const ctx = { connection: { requestRejection: vi.fn(() => rejection) } } as unknown as Context
      const res = response()
      expect(createRouteGuard(ctx)(request({ host: 'evil.example' }), res)).toBe(false)
      expect(res.status).toBe(rejection)
      expect(res.body).toBe(rejection === 401 ? 'unauthorized' : 'forbidden')
    }
  })

  it('fails closed when the composition exposes no connection service', () => {
    const res = response()
    expect(createRouteGuard({} as Context)(request({ host: '127.0.0.1:3080' }), res)).toBe(false)
    expect(res.status).toBe(403)
  })
})
