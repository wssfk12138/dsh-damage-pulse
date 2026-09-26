/** Optional bridge access; shared host bridge credentials belong to the host. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../../../wechat-notify/src/connection.ts'
import type { ModuleServices } from '../module-services.ts'
import { registerWechatRoutes } from '../wechat-routes.ts'
import { ModuleWork } from '../module-work.ts'

export function apply(ctx: Context, services: ModuleServices): void {
  ctx.inject(['wechatNotify'], notify => {
    const work = new ModuleWork()
    let active = true
    const sender = { send: (message: string) => {
      if (!active) return Promise.resolve({ ok: false as const, code: 'send-failed' as const, detail: 'Notification channel is stopped' })
      return work.run(() => notify.wechatNotify.send(message))
    } }
    services.wechat = sender
    notify.effect(() => async () => {
      active = false
      if (services.wechat === sender) delete services.wechat
      await work.stop()
    }, 'token-monitor: wechat deliveries')
  })
  ctx.inject(['wechatConnection', 'wechatNotify', 'webServer', 'connection'], web => {
    const work = new ModuleWork()
    web.effect(() => () => work.stop(), 'token-monitor: wechat connection operations')
    const connection = web.wechatConnection
    registerWechatRoutes(web, { status: () => work.run(() => connection.status()), login: () => work.run(() => connection.login()),
      confirmLogin: sessionId => work.run(() => connection.confirmLogin(sessionId)), reconnect: () => work.run(() => connection.reconnect()),
      disconnect: confirm => work.run(() => connection.disconnect(confirm)), testMessage: message => services.wechat?.send(message)
        ?? Promise.resolve({ ok: false as const, code: 'send-failed' as const, detail: 'Notification channel is stopped' }) })
  })
}
