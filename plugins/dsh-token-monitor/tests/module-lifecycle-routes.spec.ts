import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { registerModuleRoutes } from '../src/module-routes.ts'
import type { ModuleManager } from '../src/module-manager.ts'
import type { ModuleServices } from '../src/module-services.ts'
import { createNotificationEventsRouteHandler } from '../src/notification-route.ts'
import { NotificationEventBuffer } from '../src/notification-events.ts'

describe('notification module lifecycle broker', () => {
  it.each(['overview', 'displayScope'] as const)('keeps %s absence authenticated through removal and restore', async key => {
    const registered = new Map<string, (req: IncomingMessage, res: ServerResponse) => unknown>()
    let rejection: 401 | undefined
    const ctx = {
      effect: (factory: () => unknown) => factory(),
      connection: { requestRejection: () => rejection },
      webServer: { register: (route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }) => {
        registered.set(route.path, route.handler); return () => registered.delete(route.path)
      } },
    }
    const services: Pick<ModuleServices, 'overview' | 'displayScope'> = {}
    registerModuleRoutes(ctx as unknown as Context, {} as ModuleManager, 'unused', undefined, () => services)
    const handler = async (_req: IncomingMessage, res: ServerResponse) => { res.writeHead(200); res.end('actual business response') }
    const call = async (method = 'GET') => {
      const response = { status: 0, headers: {}, body: '', writeHead(status: number, headers: object = {}) { this.status = status; this.headers = headers }, end(body = '') { this.body = body } }
      await registered.get('/api/token-monitor/modules/' + (key === 'overview' ? key : 'display-scope'))!({ method, url: '/', headers: {} } as IncomingMessage, response as unknown as ServerResponse)
      return response
    }
    services[key] = handler
    expect(await call()).toMatchObject({ status: 200, body: 'actual business response' })
    delete services[key]
    expect(await call()).toMatchObject({ status: 204, body: '', headers: { 'Cache-Control': 'no-store' } })
    expect((await call('POST')).status).toBe(405)
    rejection = 401
    expect((await call()).status).toBe(401)
    rejection = undefined
    services[key] = handler
    expect((await call()).status).toBe(200)
  })
  it('authenticates and forwards the live stream, reports absence, and resumes after restore', () => {
    const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
    let rejection: 401 | undefined
    const ctx = {
      effect: (factory: () => unknown) => factory(),
      connection: { requestRejection: () => rejection },
      webServer: { register: (route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => {
        routes.set(route.path, route.handler); return () => routes.delete(route.path)
      } },
    }
    let handler: ModuleServices['notificationEvents'] = createNotificationEventsRouteHandler(new NotificationEventBuffer({ streamId: 'first' }))
    registerModuleRoutes(ctx as unknown as Context, {} as ModuleManager, 'unused', undefined, () => handler ? { notificationEvents: handler } : {})
    const call = (method = 'GET') => {
      const response = { status: 0, headers: {}, body: '', writeHead(status: number, headers: object) { this.status = status; this.headers = headers }, end(body = '') { this.body = body } }
      routes.get('/api/token-monitor/modules/notification-events')!({ method, url: '/?since=0', headers: {} } as IncomingMessage, response as unknown as ServerResponse)
      return response
    }
    expect(JSON.parse(call().body).streamId).toBe('first')
    handler = undefined
    expect(call()).toMatchObject({ status: 204, body: '', headers: { 'Cache-Control': 'no-store' } })
    expect(call('HEAD').status).toBe(204)
    expect(call('POST').status).toBe(405)
    rejection = 401
    expect(call().status).toBe(401)
    rejection = undefined
    handler = createNotificationEventsRouteHandler(new NotificationEventBuffer({ streamId: 'restored' }))
    expect(JSON.parse(call().body).streamId).toBe('restored')
  })
})
