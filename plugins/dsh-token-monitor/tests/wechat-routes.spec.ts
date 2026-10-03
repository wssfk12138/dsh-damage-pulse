import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createWechatConnectionRouteHandler,
  registerWechatRoutes,
  WECHAT_DISCONNECT_PATH,
  WECHAT_LOGIN_CONFIRM_PATH,
  WECHAT_LOGIN_PATH,
  WECHAT_RECONNECT_PATH,
  WECHAT_STATUS_PATH,
  WECHAT_TEST_PATH,
  type WechatConnectionRouteService,
} from '../src/wechat-routes.ts'

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.restoreAllMocks()
  while (disposers.length > 0) await disposers.pop()!()
})

const status = {
  schemaVersion: 1, provider: 'clawbot-wechat', availability: 'available', auth: 'authenticated',
  process: 'external', delivery: 'needs-activation', operation: 'idle',
  capabilities: { canLogin: true, canReconnect: false, canDisconnect: false }, checkedAt: 1,
}

function service(overrides: Partial<WechatConnectionRouteService> = {}): WechatConnectionRouteService {
  return {
    status: vi.fn().mockResolvedValue(status),
    login: vi.fn().mockResolvedValue({ login: { sessionId: 'session-1', expiresAt: 2, qrPayload: 'qr' }, status }),
    confirmLogin: vi.fn().mockResolvedValue({ result: 'waiting', status }),
    reconnect: vi.fn().mockResolvedValue(status),
    disconnect: vi.fn().mockResolvedValue(status),
    testMessage: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
}

async function serve(action: Parameters<typeof createWechatConnectionRouteHandler>[1], instance = service()): Promise<string> {
  const server: Server = createServer(createWechatConnectionRouteHandler(instance, action))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  disposers.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

describe('wechat connection Host routes', () => {
  it('serves GET and bodyless HEAD status with no-store', async () => {
    const endpoint = await serve('status')
    const response = await fetch(endpoint)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(status)

    const head = await fetch(endpoint, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
  })

  it('dispatches login, confirmation, reconnect, and explicit disconnect', async () => {
    const instance = service()
    const login = await serve('login', instance)
    const confirm = await serve('confirm-login', instance)
    const reconnect = await serve('reconnect', instance)
    const disconnect = await serve('disconnect', instance)

    expect((await fetch(login, { method: 'POST' })).status).toBe(200)
    expect((await fetch(confirm, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"sessionId":"abc_123-XYZ"}' })).status).toBe(200)
    expect((await fetch(reconnect, { method: 'POST' })).status).toBe(200)
    expect((await fetch(disconnect, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"confirm":true}' })).status).toBe(200)
    expect(instance.confirmLogin).toHaveBeenCalledWith('abc_123-XYZ')
    expect(instance.disconnect).toHaveBeenCalledWith(true)
  })

  it('rejects methods, media types, malformed JSON, excess fields, dangerous keys, and bodies on bodyless actions', async () => {
    const statusEndpoint = await serve('status')
    const method = await fetch(statusEndpoint, { method: 'POST' })
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('GET, HEAD')

    const confirm = await serve('confirm-login')
    expect((await fetch(confirm, { method: 'POST', body: '{}' })).status).toBe(415)
    expect((await fetch(confirm, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status).toBe(400)
    expect((await fetch(confirm, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"sessionId":"ok","token":"secret"}' })).status).toBe(400)
    expect((await fetch(confirm, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"sessionId":"ok","__proto__":{}}' })).status).toBe(400)

    const login = await serve('login')
    expect((await fetch(login, { method: 'POST', body: 'unexpected' })).status).toBe(400)
  })

  it('caps request bodies at 4 KiB', async () => {
    const endpoint = await serve('confirm-login')
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'x'.repeat(5_000) }),
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } })
  })

  it('maps BRIDGE_NOT_OWNED and scrubs unknown internal failures', async () => {
    const notOwned = await serve('reconnect', service({
      reconnect: vi.fn().mockRejectedValue(Object.assign(new Error('微信 bridge 不由 DSH Host 管理'), { code: 'BRIDGE_NOT_OWNED' })),
    }))
    const response = await fetch(notOwned, { method: 'POST' })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'BRIDGE_NOT_OWNED', message: '微信 bridge 不由 DSH Host 管理' } })

    const internal = await serve('login', service({
      login: vi.fn().mockRejectedValue(new Error('E:\\private\\credentials.json token=secret stack')),
    }))
    const failed = await fetch(internal, { method: 'POST' })
    const text = await failed.text()
    expect(failed.status).toBe(500)
    expect(text).not.toMatch(/E:\\|credentials|secret|stack/i)
  })

  it('sends a validated test message through the real notification seam', async () => {
    const instance = service()
    const endpoint = await serve('test-message', instance)
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '测试消息' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(instance.testMessage).toHaveBeenCalledWith('测试消息')

    expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":""}' })).status).toBe(400)
    expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"ok","extra":true}' })).status).toBe(400)
  })

  it('does not fake delivery when the sender needs activation or fails', async () => {
    const activation = await serve('test-message', service({
      testMessage: vi.fn().mockResolvedValue({ ok: false, code: 'activation-required', detail: 'prepare failed' }),
    }))
    const activationResponse = await fetch(activation, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"hello"}',
    })
    expect(activationResponse.status).toBe(409)
    expect(await activationResponse.json()).toEqual({ error: { code: 'ACTIVATION_REQUIRED', message: '微信通知通道需要先激活' } })

    const failed = await serve('test-message', service({
      testMessage: vi.fn().mockResolvedValue({ ok: false, code: 'send-failed', detail: 'cli failed' }),
    }))
    const failedResponse = await fetch(failed, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"hello"}',
    })
    expect(failedResponse.status).toBe(502)
    expect(await failedResponse.json()).toEqual({ error: { code: 'SEND_FAILED', message: '微信测试消息发送失败' } })
  })

  it('registers six additive seams without touching the public entry', () => {
    const dispose = vi.fn()
    const register = vi.fn((_route: Parameters<import('@deepseek-ai/dsh-host-webserver').WebServer['register']>[0]) => dispose)
    const effects: Array<() => void> = []
    const ctx = { webServer: { register }, logger: { warn: vi.fn() }, effect: (setup: () => () => void) => { effects.push(setup()) } }
    // This fixture models route registration, not a complete Cordis Context.
    registerWechatRoutes(ctx as unknown as Parameters<typeof registerWechatRoutes>[0], service())
    expect(register.mock.calls.map(call => call[0].path)).toEqual([
      WECHAT_STATUS_PATH, WECHAT_LOGIN_PATH, WECHAT_LOGIN_CONFIRM_PATH, WECHAT_RECONNECT_PATH, WECHAT_DISCONNECT_PATH, WECHAT_TEST_PATH,
    ])
    effects.forEach(dispose => dispose())
    expect(dispose).toHaveBeenCalledTimes(6)
  })
})
