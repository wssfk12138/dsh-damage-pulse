/**
 * 宿主兼容状态只读路由：设置页据此展示会话用量记录为何停写，以及如何恢复。
 * @module dsh-token-monitor/host-compat-route
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createRouteGuard } from './http-trust.ts'
import type { SessionRecordStatus } from './session-records.ts'

/** 路由路径，客户端与本模块共用。 */
export const HOST_COMPAT_PATH = '/api/token-monitor/host-compat'

/** 注册只读的宿主兼容状态路由。
 * @param ctx 拥有 web 服务的上下文。
 * @param status 当前写入能力状态。
 */
export function registerHostCompatRoute(ctx: Context, status: () => SessionRecordStatus): void {
  const guard = createRouteGuard(ctx)
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: HOST_COMPAT_PATH,
    handler: (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ schemaVersion: 1, sessionRecords: status() }))
    },
  }), 'token-monitor: host compatibility route')
}
