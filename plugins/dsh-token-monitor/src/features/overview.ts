/** Removing this feature removes queries while the core keeps collecting usage. */
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleServices } from '../module-services.ts'
import { createMetadataLoader, DetailQueries, registerDetailsRoute, registerOverviewRoute } from '../details.ts'
import { createRouteGuard } from '../http-trust.ts'
import { summarizeUsage, type UsageSummaryRange, type UsageSummaryWindow } from '../usage-summary.ts'

/** 自定义范围必须带有限且有序的毫秒边界，与使用记录列表保持同一窗口。 */
function readWindow(params: URLSearchParams): UsageSummaryWindow | undefined {
  if (!params.has('from') || !params.has('to')) return undefined
  const from = Number(params.get('from')), to = Number(params.get('to'))
  return Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to >= from ? { from, to } : undefined
}

export function apply(ctx: Context, services: ModuleServices): void {
  const { storage, details } = services
  const queries = new DetailQueries(storage, details, services.priceTable())
  const metadata = createMetadataLoader(ctx, details, () => [...storage.history().map(row => row.sessionId), ...[...details.attempts.values()].map(row => row.sessionId)])
  ctx.inject(['webServer', 'connection'], web => {
    const guard = createRouteGuard(web)
    registerDetailsRoute(web, queries, metadata)
    registerOverviewRoute(web, details, metadata)
    web.effect(() => web.webServer.register({ kind: 'exact', path: '/api/token-monitor/usage', handler: (req, res) => {
      if (!guard(req, res)) return
      const url = new URL(req.url ?? '/', 'http://localhost')
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(storage.history(url.searchParams.get('sessionId') ?? undefined)))
    } }), 'token-monitor: usage route')
    web.effect(() => web.webServer.register({ kind: 'exact', path: '/api/token-monitor/usage-summary', handler: (req, res) => {
      if (!guard(req, res)) return
      const url = new URL(req.url ?? '/', 'http://localhost')
      const range = url.searchParams.get('range') ?? 'today'
      const window = readWindow(url.searchParams)
      const valid = ['all', '30d', '7d', 'yesterday', 'today', 'custom'].includes(range) && (range !== 'custom' || window !== undefined)
      res.writeHead(valid ? 200 : 400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(valid ? summarizeUsage(storage.history(), range as UsageSummaryRange, Date.now(), url.searchParams.get('provider') ?? undefined, window) : { error: { code: range === 'custom' ? 'INVALID_TIME' : 'INVALID_RANGE' } }))
    } }), 'token-monitor: usage summary route')
  })
}
