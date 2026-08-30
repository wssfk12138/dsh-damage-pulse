/**
 * dsh-token-monitor —— DeepSeek Harness Token 用量与金额监控插件。
 *
 * M1：Host 采集器 —— 监听 session/event，累计每次模型调用的 token 与金额。
 * M2：余额查询服务 —— 复用 ctx.credentials 取 key，定时轮询 DeepSeek /user/balance。
 * M3：tokenCost projection —— 经 session-projection 把会话累计 token/金额推送到 Web Client。
 * M4：Web Client UI（Conversation Node 用量行 + 会话统计条 + 余额卡片）。
 * M6：单次用量明细持久化 + 历史查询端点。
 *
 * @module dsh-token-monitor
 */

import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_TOKEN_MONITOR_SETTINGS } from '../../../packages/util/token-monitor-contract/src/index.ts'
// Type-only：触发 ctx.sessionProjections 的 Context 声明合并。
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only：触发 ctx.sessionProjectionCache / ctx.sessionPersistence 的 Context 声明合并。
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-session-persistence'
// Type-only：触发 ctx.webServer 的 Context 声明合并。
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only：触发可选 ctx.wechatNotify 的 Context 声明合并。
import type { WechatNotifyResult } from '../../wechat-notify/src/sender.ts'
import type {} from '../../wechat-notify/src/connection.ts'
import { installBundledWechat } from '../../wechat-notify/src/index.ts'
import { registerWechatTools } from '../../wechat-notify/src/tools.ts'
import { provideTokenMonitorWechat } from './wechat.ts'
import { attachCollector } from './collector.ts'
import { createCacheHitAnomalyDetector, formatCacheHitAnomalyMessage } from './cache-hit-anomaly.ts'
import { attachBalance, registerBalanceRoute } from './balance.ts'
import { attachBudgetThresholdNotifications } from './budget-notify.ts'
import { registerBudgetRoutes } from './budget-routes.ts'
import { registerChargeEventsRoute } from './charge-route.ts'
import {
  createBudgetThresholdNotification,
  createCacheHitAnomalyNotification,
  createPeakTransitionNotification,
  NotificationEventBuffer,
} from './notification-events.ts'
import { registerNotificationEventsRoute } from './notification-route.ts'
import { attachPeakBoundaryReminder } from './peak-reminder.ts'
import { createTokenCostProjectionDefinition } from './projection.ts'
import { PRICE_TABLE, resolvePricingEligibility, type PricingTable } from './pricing.ts'
import {
  registerTokenMonitorSettings,
  registerTokenMonitorSettingsRoute,
  type TokenMonitorStoredSettings,
} from './settings.ts'
import { UsageStorage } from './storage.ts'
import { summarizeUsage, type UsageSummaryRange } from './usage-summary.ts'
import { registerWechatRoutes } from './wechat-routes.ts'
import { registerUpdateRoutes } from './update.ts'
import { registerTokenMonitorAssetRoutes } from './assets.ts'
import { migrateMissingTokenCost } from './migration.ts'
export { registerWhaleAssetRoute } from './assets.ts'

export const name = 'dsh-token-monitor'
export const inject = ['sessions', 'credentials']

interface WechatNotificationSender {
  send(message: string): Promise<WechatNotifyResult>
}

/** Dynamic master gate shared by budget, peak-period, and cache anomaly delivery. */
export function createGatedWechatSender(
  isEnabled: () => boolean,
  getSender: () => WechatNotificationSender | undefined,
) {
  return {
    async send(message: string) {
      const sender = getSender()
      if (!isEnabled() || sender === undefined) return { ok: true as const }
      return await sender.send(message)
    },
  }
}

type C2RuntimeSettings = Pick<TokenMonitorStoredSettings,
  | 'dailyBudgetEnabled'
  | 'dailyBudgetCny'
  | 'budgetExceededNotificationEnabled'
  | 'peakReminderEnabled'
  | 'peakReminderEnterPeak'
  | 'peakReminderEnterValley'
  | 'wechatNotificationsEnabled'
  | 'cacheHitAnomalyNotificationEnabled'
  | 'cacheHitAnomalyThreshold'
  | 'cacheHitAnomalyConsecutiveCalls'
>

const DEFAULT_C2_RUNTIME_SETTINGS: Readonly<C2RuntimeSettings> = Object.freeze({
  dailyBudgetEnabled: DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetEnabled,
  dailyBudgetCny: DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetCny,
  budgetExceededNotificationEnabled: DEFAULT_TOKEN_MONITOR_SETTINGS.budgetExceededNotificationEnabled,
  peakReminderEnabled: DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnabled,
  peakReminderEnterPeak: DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterPeak,
  peakReminderEnterValley: DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterValley,
  wechatNotificationsEnabled: DEFAULT_TOKEN_MONITOR_SETTINGS.wechatNotificationsEnabled,
  cacheHitAnomalyNotificationEnabled: DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyNotificationEnabled,
  cacheHitAnomalyThreshold: DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyThreshold,
  cacheHitAnomalyConsecutiveCalls: DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyConsecutiveCalls,
})

const readDefaultC2Settings = (): C2RuntimeSettings => DEFAULT_C2_RUNTIME_SETTINGS

export function apply(ctx: Context) {
  console.log('[dsh-token-monitor] plugin loaded')
  installBundledWechat(ctx)
  registerWechatTools(ctx)
  provideTokenMonitorWechat(ctx)

  // 价格表：settings 可覆盖，启动时读取一次（改后需重启生效）。
  // settings 在 web 装配里先于本插件就绪，故 inject 回调同步执行。
  let priceTable: PricingTable = PRICE_TABLE
  let readC2Settings: () => C2RuntimeSettings = readDefaultC2Settings
  ctx.inject(['settings'], async (settingsCtx) => {
    const registration = registerTokenMonitorSettings(settingsCtx.settings)
    const section = registration.scope.get()
    const readScopeSettings = (): C2RuntimeSettings => registration.scope.get()
    readC2Settings = readScopeSettings
    settingsCtx.effect(() => () => {
      if (readC2Settings === readScopeSettings) readC2Settings = readDefaultC2Settings
    }, 'dsh-token-monitor: C2 runtime settings')
    if (section.priceTable !== undefined) {
      priceTable = section.priceTable
      console.log(`[dsh-token-monitor] 使用 settings 价格表 v${priceTable.version}`)
    }
    console.log(`[dsh-token-monitor] 使用每日预算 CNY ${section.dailyBudgetCny.toFixed(2)}`)

    // 先完成旧配置迁移，再开放公开设置 API，避免客户端读到半迁移状态。
    await registration.ready
    settingsCtx.inject(['webServer'], (webCtx) => {
      registerTokenMonitorSettingsRoute(webCtx, registration)
      console.log('[dsh-token-monitor] settings route registered')
    })
  })

  const storage = new UsageStorage((record) =>
    resolvePricingEligibility(record.provider, record.model, record.timestamp, priceTable) !== undefined
  )
  const notificationEvents = new NotificationEventBuffer()
  let wechatSender: Context['wechatNotify'] | undefined
  const gatedWechatSender = createGatedWechatSender(
    () => readC2Settings().wechatNotificationsEnabled,
    () => wechatSender,
  )
  const cacheHitAnomalyDetector = createCacheHitAnomalyDetector(() => ({
    enabled: readC2Settings().cacheHitAnomalyNotificationEnabled,
    thresholdPercent: readC2Settings().cacheHitAnomalyThreshold,
    consecutiveCalls: readC2Settings().cacheHitAnomalyConsecutiveCalls,
  }))

  attachCollector(ctx, storage, priceTable, {
    onPersistedRecord: (record) => {
      const anomaly = cacheHitAnomalyDetector.observe(record)
      if (anomaly !== undefined) {
        const event = notificationEvents.publish(createCacheHitAnomalyNotification(anomaly))
        if (event !== undefined) {
          void gatedWechatSender.send(formatCacheHitAnomalyMessage(anomaly)).catch(error => {
            console.warn(`[dsh-token-monitor] 缓存命中异常微信通知发送失败: ${String(error)}`)
          })
        }
      }
    },
  })
  const balance = attachBalance(ctx)

  // 通知事件始终由 Host 业务源产生；微信只是一个可选的下游发送通道。
  attachPeakBoundaryReminder(ctx, gatedWechatSender, {
    settings: () => readC2Settings(),
    onTransition: transition => {
      notificationEvents.publish(createPeakTransitionNotification(transition))
    },
  })
  attachBudgetThresholdNotifications(ctx, storage, () => readC2Settings(), gatedWechatSender, {
    onCrossing: (crossing, observedAt) => {
      notificationEvents.publish(createBudgetThresholdNotification(crossing, observedAt))
    },
  })

  // WeChat 是可选能力；注入和释放只更新动态发送器，不重建预算/峰谷跟踪状态。
  ctx.inject(['wechatNotify'], (notifyCtx) => {
    const sender = notifyCtx.wechatNotify
    wechatSender = sender
    notifyCtx.effect(() => () => {
      if (wechatSender === sender) wechatSender = undefined
    }, 'dsh-token-monitor: optional wechat sender')
  })

  // 条件注册 tokenCost projection：仅当组合树提供了 sessionProjections 服务时生效。
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(createTokenCostProjectionDefinition(priceTable))
    console.log('[dsh-token-monitor] tokenCost projection registered')
  })

  // 同步迁移：依赖 sessionProjections（确保 tokenCost 已注册）+ 缓存 + 持久化，
  // await 完成，保证在 Client 首次列表读之前补齐历史会话的 tokenCost。
  ctx.inject(['sessionProjections', 'sessionProjectionCache', 'sessionPersistence'], async (migrateCtx) => {
    await migrateMissingTokenCost(migrateCtx)
  })

  // 条件注册余额/用量明细 HTTP 端点：仅 web 装配有 webServer 服务。
  ctx.inject(['webServer'], (webCtx) => {
    registerTokenMonitorAssetRoutes(webCtx)
    console.log('[dsh-token-monitor] asset routes registered')
    registerBalanceRoute(webCtx, balance)
    console.log('[dsh-token-monitor] balance route registered')

    // 用量明细历史查询端点（可按 sessionId 过滤）。
    webCtx.webServer.register({
      kind: 'exact',
      path: '/api/token-monitor/usage',
      handler: (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sessionId = url.searchParams.get('sessionId') ?? undefined
        const records = storage.history(sessionId)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(records))
      },
    })
    console.log('[dsh-token-monitor] usage route registered')

    // 今日花费：以 usage.jsonl 回读后的合格记录为权威源，按北京时间自然日聚合。
    webCtx.webServer.register({
      kind: 'exact',
      path: '/api/token-monitor/today-spend',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(storage.todaySpend()))
      },
    })
    console.log('[dsh-token-monitor] today-spend route registered')

    webCtx.webServer.register({
      kind: 'exact',
      path: '/api/token-monitor/usage-summary',
      handler: (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const rawRange = url.searchParams.get('range') ?? 'today'
        const validRanges = new Set<UsageSummaryRange>(['all', '30d', '7d', 'today'])
        const range = validRanges.has(rawRange as UsageSummaryRange) ? rawRange as UsageSummaryRange : undefined
        const summary = range === undefined ? undefined : summarizeUsage(storage.history(), range, Date.now())
        const origin = req.headers.origin
        const cors = origin === 'http://127.0.0.1:18765' || origin === 'http://localhost:18765'
          ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
          : {}
        res.writeHead(summary === undefined ? 400 : 200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...cors,
        })
        res.end(JSON.stringify(summary === undefined ? { error: { code: 'INVALID_RANGE', message: 'range 必须是 all、30d、7d 或 today' } } : summary))
      },
    })
    console.log('[dsh-token-monitor] usage-summary route registered')

    registerBudgetRoutes(webCtx, storage, () => readC2Settings().dailyBudgetCny, priceTable)
    console.log('[dsh-token-monitor] daily budget and pricing eligibility routes registered')

    registerNotificationEventsRoute(webCtx, notificationEvents)
    console.log('[dsh-token-monitor] notification events route registered')

    registerUpdateRoutes(webCtx)
    console.log('[dsh-token-monitor] update routes registered')

    registerChargeEventsRoute(webCtx)
    console.log('[dsh-token-monitor] charge-events route registered')
  })

  ctx.inject(['wechatConnection', 'wechatNotify', 'webServer'], (wechatCtx) => {
    const connection = wechatCtx.wechatConnection
    registerWechatRoutes(wechatCtx, {
      status: () => connection.status(),
      login: () => connection.login(),
      confirmLogin: sessionId => connection.confirmLogin(sessionId),
      reconnect: () => connection.reconnect(),
      disconnect: confirm => connection.disconnect(confirm),
      testMessage: message => wechatCtx.wechatNotify.send(message),
    })
    console.log('[dsh-token-monitor] wechat connection routes registered')
  })
}
