import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  SettingsConflictError,
  type SettingsDescriptor,
  type SettingsNamespace,
  type SettingsProvider,
  type SettingsScope,
} from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_TOKEN_MONITOR_SETTINGS,
  TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY,
  TOKEN_MONITOR_SETTINGS_MAX_BODY_BYTES,
  TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
  UnsupportedTokenMonitorSettingsVersionError,
  parseTokenMonitorSettingsPatchRequest,
  pickPublicTokenMonitorSettings,
  planTokenMonitorSettingsMigration,
  type TokenMonitorSettingsErrorCode,
  type TokenMonitorSettingsErrorResponse,
  type TokenMonitorSettingsPatchRequest,
  type TokenMonitorSettingsSnapshot,
} from '../../../packages/util/token-monitor-contract/src/index.ts'
import { PRICE_TABLE, type PricingTable } from './pricing.ts'

// This fixed valid key works with legacy branded types and newer string-based APIs.
// Upstream removed the runtime helper in deepseek-harness commit f4e49cc.
export const TOKEN_MONITOR_SETTINGS_NS = 'dsh-token-monitor' as SettingsNamespace

export interface TokenMonitorStoredSettings {
  schemaVersion: number
  priceTable: PricingTable
  displayMode: 'balance' | 'spend'
  showWhaleGirl: boolean
  dailyBudgetEnabled: boolean
  dailyBudgetCny: number
  budgetExceededNotificationEnabled: boolean
  peakReminderEnabled: boolean
  peakReminderEnterPeak: boolean
  peakReminderEnterValley: boolean
  notifyOncePerTransition: boolean
  whaleBubbleEnabled: boolean
  wechatNotificationsEnabled: boolean
  cacheHitAnomalyNotificationEnabled: boolean
  cacheHitAnomalyThreshold: number
  cacheHitAnomalyConsecutiveCalls: number
}

const settingsSchema: z<TokenMonitorStoredSettings> = z.object({
  schemaVersion: z.number().min(0).default(TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION),
  // Internal pricing override: intentionally omitted from the public settings API.
  priceTable: z.any().default(PRICE_TABLE),
  displayMode: z.union(['balance', 'spend'] as const).default(DEFAULT_TOKEN_MONITOR_SETTINGS.displayMode),
  showWhaleGirl: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.showWhaleGirl),
  dailyBudgetEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetEnabled),
  dailyBudgetCny: z.number()
    .min(Number.MIN_VALUE)
    .max(TOKEN_MONITOR_MAX_DAILY_BUDGET_CNY)
    .default(DEFAULT_TOKEN_MONITOR_SETTINGS.dailyBudgetCny),
  budgetExceededNotificationEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.budgetExceededNotificationEnabled),
  peakReminderEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnabled),
  peakReminderEnterPeak: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterPeak),
  peakReminderEnterValley: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.peakReminderEnterValley),
  notifyOncePerTransition: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.notifyOncePerTransition),
  whaleBubbleEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.whaleBubbleEnabled),
  wechatNotificationsEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.wechatNotificationsEnabled),
  cacheHitAnomalyNotificationEnabled: z.boolean().default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyNotificationEnabled),
  cacheHitAnomalyThreshold: z.number().min(0).max(100).default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyThreshold),
  cacheHitAnomalyConsecutiveCalls: z.number().min(2).max(20).default(DEFAULT_TOKEN_MONITOR_SETTINGS.cacheHitAnomalyConsecutiveCalls),
})

function validateResolvedSettings(value: TokenMonitorStoredSettings): void {
  if (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 0) {
    throw new TypeError('dsh-token-monitor schemaVersion must be a non-negative safe integer')
  }
  if (value.schemaVersion > TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION) {
    throw new UnsupportedTokenMonitorSettingsVersionError(value.schemaVersion)
  }
  // The shared wire validator also enforces monetary precision.
  pickPublicTokenMonitorSettings(value as unknown as Record<string, unknown>)
}

function descriptorFor(settings: SettingsProvider): SettingsDescriptor {
  const descriptor = settings.describe({ redactSecrets: true })
    .find(candidate => candidate.ns === TOKEN_MONITOR_SETTINGS_NS)
  if (descriptor === undefined) throw new Error('dsh-token-monitor settings namespace is not registered')
  return descriptor
}

async function migrateLegacySettings(settings: SettingsProvider): Promise<void> {
  // A conflicting external write is re-read and re-planned; a persistent
  // conflict fails startup rather than claiming a migration happened.
  for (let attempt = 0; attempt < 3; attempt++) {
    const descriptor = descriptorFor(settings)
    const patch = planTokenMonitorSettingsMigration(descriptor.user)
    if (patch === undefined) return
    try {
      await settings.update(TOKEN_MONITOR_SETTINGS_NS, patch, descriptor.revision)
      return
    } catch (error) {
      if (error instanceof SettingsConflictError && attempt < 2) continue
      throw error
    }
  }
}

export interface TokenMonitorSettingsRegistration {
  scope: SettingsScope<TokenMonitorStoredSettings>
  ready: Promise<void>
}

export function registerTokenMonitorSettings(settings: SettingsProvider): TokenMonitorSettingsRegistration {
  const scope = settings.register(TOKEN_MONITOR_SETTINGS_NS, settingsSchema, {
    applies: 'live',
    validate: validateResolvedSettings,
  })
  return { scope, ready: migrateLegacySettings(settings) }
}

export interface TokenMonitorSettingsController {
  read(): TokenMonitorSettingsSnapshot
  patch(request: TokenMonitorSettingsPatchRequest): Promise<TokenMonitorSettingsSnapshot>
}

export function createTokenMonitorSettingsController(
  settings: SettingsProvider,
  scope: SettingsScope<TokenMonitorStoredSettings>,
): TokenMonitorSettingsController {
  const read = (): TokenMonitorSettingsSnapshot => {
    const descriptor = descriptorFor(settings)
    return {
      schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
      revision: descriptor.revision,
      settings: pickPublicTokenMonitorSettings(scope.get() as unknown as Record<string, unknown>),
    }
  }
  return {
    read,
    async patch(request) {
      if (Object.keys(request.patch).length === 0) return read()
      await settings.update(TOKEN_MONITOR_SETTINGS_NS, request.patch, request.expectedRevision)
      return read()
    },
  }
}

class RequestBodyError extends Error {
  constructor(readonly code: 'INVALID_JSON' | 'PAYLOAD_TOO_LARGE', message: string) {
    super(message)
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  head = false,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(head ? undefined : JSON.stringify(value))
}

function sendError(
  response: ServerResponse,
  status: number,
  code: TokenMonitorSettingsErrorCode,
  message: string,
  fields?: Record<string, string>,
  headers?: Record<string, string>,
): void {
  const body: TokenMonitorSettingsErrorResponse = {
    error: { code, message, ...(fields === undefined ? {} : { details: { fields } }) },
  }
  sendJson(response, status, body, false, headers)
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentLength = request.headers['content-length']
  if (contentLength !== undefined) {
    const declared = Number(contentLength)
    if (Number.isFinite(declared) && declared > TOKEN_MONITOR_SETTINGS_MAX_BODY_BYTES) {
      request.resume()
      throw new RequestBodyError('PAYLOAD_TOO_LARGE', '请求体超过 16 KiB 限制')
    }
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > TOKEN_MONITOR_SETTINGS_MAX_BODY_BYTES) {
      request.resume()
      throw new RequestBodyError('PAYLOAD_TOO_LARGE', '请求体超过 16 KiB 限制')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim().length === 0) throw new RequestBodyError('INVALID_JSON', '请求体不能为空')
  try {
    return JSON.parse(text)
  } catch {
    throw new RequestBodyError('INVALID_JSON', '请求体不是有效 JSON')
  }
}

export type TokenMonitorSettingsRouteHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

export function createTokenMonitorSettingsRouteHandler(
  controller: TokenMonitorSettingsController,
  reportInternalError: (error: unknown) => void = () => undefined,
): TokenMonitorSettingsRouteHandler {
  return async (request, response) => {
    const method = request.method ?? 'GET'
    if (method === 'GET' || method === 'HEAD') {
      sendJson(response, 200, controller.read(), method === 'HEAD')
      return
    }
    if (method !== 'PATCH') {
      sendError(response, 405, 'METHOD_NOT_ALLOWED', '仅支持 GET、HEAD 和 PATCH', undefined, {
        Allow: 'GET, HEAD, PATCH',
      })
      return
    }
    const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (mediaType !== 'application/json') {
      sendError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'PATCH 请求必须使用 application/json')
      return
    }
    let body: unknown
    try {
      body = await readJsonBody(request)
    } catch (error) {
      if (error instanceof RequestBodyError) {
        sendError(response, error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, error.code, error.message)
        return
      }
      reportInternalError(error)
      sendError(response, 500, 'WRITE_FAILED', '设置读取失败，请稍后重试')
      return
    }
    const parsed = parseTokenMonitorSettingsPatchRequest(body)
    if (!parsed.ok) {
      sendError(response, 400, 'VALIDATION_ERROR', '设置字段校验失败', parsed.fields)
      return
    }
    try {
      sendJson(response, 200, await controller.patch(parsed.value))
    } catch (error) {
      if (error instanceof SettingsConflictError) {
        sendError(response, 409, 'CONFLICT', '设置已被其他窗口更新，请刷新后重试')
        return
      }
      reportInternalError(error)
      sendError(response, 500, 'WRITE_FAILED', '设置保存失败，原设置保持不变')
    }
  }
}

export function registerTokenMonitorSettingsRoute(
  ctx: Context,
  registration: TokenMonitorSettingsRegistration,
): void {
  const controller = createTokenMonitorSettingsController(ctx.settings, registration.scope)
  const handler = createTokenMonitorSettingsRouteHandler(controller, (error) => {
    ctx.logger.warn('dsh-token-monitor settings route failed')
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/token-monitor/settings',
    handler: (request, response) => handler(request, response),
  })
}
