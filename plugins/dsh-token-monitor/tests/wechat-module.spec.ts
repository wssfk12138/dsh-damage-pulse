import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModuleServices } from '../src/module-services.ts'
import type { WechatConnectionRouteService } from '../src/wechat-routes.ts'
const capture = vi.hoisted(() => ({ service: undefined as WechatConnectionRouteService | undefined }))
vi.mock('../src/wechat-routes.ts', () => ({ registerWechatRoutes: (_ctx: unknown, service: WechatConnectionRouteService) => { capture.service = service } }))
import { apply } from '../src/features/wechat.ts'
afterEach(() => vi.unstubAllEnvs())

function fixture() {
  vi.stubEnv('WECHAT_NOTIFY_CLAWBOT_INDEX', '')
  const shared: Record<string, unknown> = {}
  const cleanups: Array<() => Promise<void>> = []
  const ctx = { get: (name: string) => shared[name], effect: (factory: () => () => Promise<void>) => cleanups.push(factory()),
    inject: (_keys: string[], callback: (ctx: unknown) => void) => callback(ctx) }
  const services = {} as ModuleServices
  apply(ctx as unknown as Context, services)
  return { shared, services, routes: capture.service!, stop: () => Promise.all(cleanups.map(cleanup => cleanup())) }
}
describe('optional WeChat module', () => {
  it('registers status without an external plugin and reports unavailable sending honestly', async () => {
    const f = fixture()
    expect(await f.routes.status()).toMatchObject({ availability: 'unsupported', capabilities: { canLogin: false } })
    expect(await f.routes.testMessage!('test')).toMatchObject({ ok: false, code: 'send-failed' })
    await f.stop()
  })
  it('uses late host services once and preserves send-only ownership', async () => {
    const f = fixture(), send = vi.fn(async () => ({ ok: true as const }))
    f.shared.wechatNotify = { send }
    expect(await f.routes.status()).toMatchObject({ lastError: { code: 'LEGACY_SENDER_ONLY' } })
    await expect(f.routes.login()).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(await f.routes.testMessage!('one')).toEqual({ ok: true })
    expect(send).toHaveBeenCalledExactlyOnceWith('one')
    const status = vi.fn(async () => ({ shared: true }))
    f.shared.wechatConnection = { status }
    expect(await f.routes.status()).toEqual({ shared: true })
    await f.stop()
  })
  it('waits for admitted deliveries without stopping a shared service', async () => {
    const f = fixture(), stop = vi.fn()
    let finish!: (value: { ok: true }) => void
    f.shared.wechatNotify = { send: () => new Promise(resolve => { finish = resolve }), stop }
    const sender = f.services.wechat!, delivery = sender.send('pending')
    let stopped = false
    const disposal = f.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(f.services.wechat).toBeUndefined()
    expect(await sender.send('late')).toMatchObject({ ok: false })
    finish({ ok: true }); await delivery; await disposal
    expect(stop).not.toHaveBeenCalled()
  })
})
