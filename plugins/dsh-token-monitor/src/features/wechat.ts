/** Optional bridge access; shared host bridge credentials belong to the host. */
import type { Context } from '@deepseek-ai/cordis'
import { ClawbotFilesystemGateway, WechatConnectionAdapter, WechatConnectionError } from '../../../wechat-notify/src/connection.ts'
import { ClawbotWechatSender } from '../../../wechat-notify/src/sender.ts'
import type { ModuleServices } from '../module-services.ts'
import { registerWechatRoutes } from '../wechat-routes.ts'
import { ModuleWork } from '../module-work.ts'

export function apply(ctx: Context, services: ModuleServices): void {
  const clawbotIndex = process.env.WECHAT_NOTIFY_CLAWBOT_INDEX?.trim() ?? ''
  const fallbackSender = new ClawbotWechatSender({ clawbotIndex })
  const fallbackConnection = new WechatConnectionAdapter({ gateway: new ClawbotFilesystemGateway({
    clawbotIndex, ...(process.env.WECHAT_NOTIFY_DATA_DIRECTORY ? { dataDirectory: process.env.WECHAT_NOTIFY_DATA_DIRECTORY } : {}),
  }) })
  const work = new ModuleWork()
  let active = true
  const sender = { send: (message: string) => {
    if (!active) return Promise.resolve({ ok: false as const, code: 'send-failed' as const, detail: 'Notification channel is stopped' })
    return work.run(() => (ctx.get('wechatNotify', false) ?? fallbackSender).send(message))
  } }
  services.wechat = sender
  ctx.effect(() => async () => {
    active = false
    if (services.wechat === sender) delete services.wechat
    await work.stop()
  }, 'token-monitor: wechat deliveries')
  ctx.inject(['webServer', 'connection'], web => {
  const connection = () => {
    const shared = ctx.get('wechatConnection', false)
    if (shared) return shared
    if (ctx.get('wechatNotify', false)) throw new WechatConnectionError('UNSUPPORTED', '登录管理由原微信插件负责')
    return fallbackConnection
  }
  registerWechatRoutes(web, { status: () => work.run(async () => {
    const shared = ctx.get('wechatConnection', false)
    if (shared) return shared.status()
    if (!ctx.get('wechatNotify', false)) return fallbackConnection.status()
    return { schemaVersion: 1, provider: 'clawbot-wechat', availability: 'unsupported',
      auth: 'unknown', process: 'unknown', delivery: 'unknown', operation: 'idle',
      capabilities: { canLogin: false, canReconnect: false, canDisconnect: false },
      lastError: { code: 'LEGACY_SENDER_ONLY', message: '发送可用，登录管理由原插件负责' }, checkedAt: Date.now() }
  }), login: () => work.run(() => connection().login()),
    confirmLogin: sessionId => work.run(() => connection().confirmLogin(sessionId)), reconnect: () => work.run(() => connection().reconnect()),
    disconnect: confirm => work.run(() => connection().disconnect(confirm)), testMessage: message => sender.send(message) })
  })
}
