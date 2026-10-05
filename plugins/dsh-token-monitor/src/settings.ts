/**
 * Token Monitor 的 Host 设置接口。
 *
 * 0.1.7 起用户偏好由 profile patch 上的 `Config` 承载，插件不再注册独立设置文档；
 * 计费规则、余额脚本与端点审批留在插件自有 JSON 状态里，各自带 revision。
 * 四条 HTTP 路由（设置、计费事件流、计费规则、计费模板）保持原有路径与响应形状。
 * @module dsh-token-monitor/settings
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import {
  TOKEN_MONITOR_SETTINGS_MAX_BODY_BYTES,
  TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
  parseTokenMonitorSettingsPatchRequest,
  validateBillingRules,
  type BillingRules,
  type BillingSnapshot,
  type TokenMonitorSettingsErrorCode,
  type TokenMonitorSettingsErrorResponse,
  type TokenMonitorSettingsPatchRequest,
  type TokenMonitorSettingsSnapshot,
} from '@deepseek-ai/dsh-token-monitor-contract'
import { defaultBillingRules } from './billing.ts'
import { createRouteGuard } from './http-trust.ts'
import { PluginStoreConflictError, type TokenMonitorStore } from './plugin-store.ts'
import { createSettingsHandle, type TokenMonitorSettingsHandle } from './settings-handle.ts'
import type { TokenMonitorUserConfig } from './config-base.ts'
import { TOKEN_MONITOR_SETTINGS_NS, liveUserConfig, readProviderSettings, resolveConfigRevision, validProviderId, writeUserConfig } from './user-settings.ts'

export { TOKEN_MONITOR_SETTINGS_NS, readProviderSettings, validProviderId, writeUserConfig } from './user-settings.ts'
export type { TokenMonitorSettingsHandle } from './settings-handle.ts'

export interface TokenMonitorSettingsController {
  read(): TokenMonitorSettingsSnapshot
  patch(request: TokenMonitorSettingsPatchRequest): Promise<TokenMonitorSettingsSnapshot>
}

/** 把一位 provider 的视角接在当前活配置与自有状态之上。 */
export function createTokenMonitorSettingsController(
  ctx: Context,
  handle: TokenMonitorSettingsHandle,
  provider = 'deepseek-official',
  /** 本插件在 profile 里的条目 id；生产环境与命名空间同名。 */
  ns = TOKEN_MONITOR_SETTINGS_NS,
): TokenMonitorSettingsController {
  if (!validProviderId(provider)) throw new TypeError('Invalid provider id')
  const read = (): TokenMonitorSettingsSnapshot => ({
    schemaVersion: TOKEN_MONITOR_SETTINGS_SCHEMA_VERSION,
    revision: resolveConfigRevision(ctx, ns),
    settings: readProviderSettings(handle.user(), provider),
  })
  return {
    read,
    async patch(request) {
      if (Object.keys(request.patch).length === 0) return read()
      if (provider === 'deepseek-official') {
        await writeUserConfig(ctx, request.patch, request.expectedRevision, ns)
      } else {
        if (Object.keys(request.patch).some(key => key === 'showWhaleGirl' || key === 'displayMode' || key === 'animationScale')) {
          throw new TypeError('Display preferences are global')
        }
        const current = handle.user().providerNotifications ?? {}
        await writeUserConfig(ctx, {
          providerNotifications: { ...current, [provider]: { ...current[provider], ...request.patch } },
        } as TokenMonitorUserConfig, request.expectedRevision, ns)
      }
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
      if (error instanceof TypeError) {
        sendError(response, 400, 'VALIDATION_ERROR', error.message)
        return
      }
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
  handle: TokenMonitorSettingsHandle,
  operations?: { allowed(key: string): boolean; run<T>(action: () => Promise<T>): Promise<T> },
): void {
  const guard = createRouteGuard(ctx)
  const scopedController = (provider?: string): TokenMonitorSettingsController => {
    const controller = createTokenMonitorSettingsController(ctx, handle, provider)
    return { read: controller.read, patch: request => {
      const patch = () => {
        if (operations && Object.keys(request.patch).some(key => !operations.allowed(key))) throw new TypeError('MODULE_NOT_INSTALLED')
        return controller.patch(request)
      }
      return operations ? operations.run(patch) : patch()
    } }
  }
  const controller = scopedController()
  const handler = createTokenMonitorSettingsRouteHandler(controller, (error) => {
    ctx.logger.warn('dsh-token-monitor settings route failed')
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/token-monitor/settings',
    handler: (request, response) => {
      if (!guard(request, response)) return
      const provider = new URL(request.url ?? '/', 'http://localhost').searchParams.get('provider')
      if (provider === null) return handler(request, response)
      if (!validProviderId(provider)) { sendError(response, 400, 'VALIDATION_ERROR', '供应商标识无效'); return }
      return createTokenMonitorSettingsRouteHandler(scopedController(provider))(request, response)
    },
  }), 'dsh-token-monitor: provider notification settings route')
}

/** 计费路由与计费模块共享同一条可移除的生命周期。
 * @param ctx 拥有 web 服务的上下文。
 * @param store 插件自有状态。
 * @param handle 活用户配置视图。
 */
export function registerBillingSettingsRoutes(ctx: Context, store: TokenMonitorStore, handle: TokenMonitorSettingsHandle): void {
  const guard = createRouteGuard(ctx)
  ctx.effect(() => {
    const clients = new Set<ServerResponse>()
    const snapshot = () => readBillingSnapshot(store, handle)
    const publish = () => {
      const data = `data: ${JSON.stringify(snapshot())}\n\n`
      for (const client of clients) {
        // Slow readers reconnect and receive the latest complete snapshot.
        if (!client.write(data)) client.destroy()
      }
    }
    // 自有状态与活配置任一变化都推送一次完整快照。
    const unwatch = store.subscribe(publish)
    const unwatchConfig = ctx.events.on('loader/volatile-update', publish)
    const unwatchNamespace = ctx.events.on('settings/updated', publish)
    const unregister = ctx.webServer.register({
      kind: 'exact', path: '/api/token-monitor/billing/events',
      handler: (request, response) => {
        if (!guard(request, response)) return
        if (request.method !== 'GET') { sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }); return }
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
        clients.add(response)
        response.on('close', () => { clients.delete(response) })
        response.write(`data: ${JSON.stringify(snapshot())}\n\n`)
      },
    })
    return () => { unwatch(); unwatchConfig(); unwatchNamespace(); unregister(); for (const client of clients) client.end(); clients.clear() }
  }, 'dsh-token-monitor: live billing snapshots')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/token-monitor/billing',
    handler: async (request, response) => {
      if (!guard(request, response)) return
      if (request.method === 'GET') { sendJson(response, 200, readBillingSnapshot(store, handle)); return }
      if (request.method !== 'PUT') { sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }); return }
      if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') { sendJson(response, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE' } }); return }
      let rules: BillingRules, revision: number
      try {
        // Model catalogs can exceed the ordinary settings request size.
        let bytes = 0
        const chunks: Buffer[] = []
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += buffer.length
          if (bytes > 2 * 1024 * 1024) { sendJson(response, 413, { error: { code: 'PAYLOAD_TOO_LARGE' } }); return }
          chunks.push(buffer)
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['expectedRevision', 'rules'].includes(key)) || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0) throw new TypeError('Invalid billing revision')
        rules = validateBillingRules(body.rules)
        revision = body.expectedRevision as number
      } catch { sendJson(response, 400, { error: { code: 'VALIDATION_ERROR' } }); return }
      try {
        await store.update({ billing: rules }, revision)
        sendJson(response, 200, readBillingSnapshot(store, handle))
      } catch (error) {
        const conflict = error instanceof PluginStoreConflictError
        sendJson(response, conflict ? 409 : 500, { error: { code: conflict ? 'CONFLICT' : 'WRITE_FAILED' } })
      }
    },
  }), 'dsh-token-monitor: billing rules')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/token-monitor/billing/templates',
    handler: (request, response) => {
      if (!guard(request, response)) return
      if (request.method !== 'GET') { sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED' } }); return }
      sendJson(response, 200, defaultBillingRules(handle.priceTable()))
    },
  }), 'dsh-token-monitor: billing templates')
}

/** 读取当前的 Host 级计费规则，不改写历史记录。
 * @param store 插件自有状态，持有计费 revision。
 * @param handle 活用户配置视图。
 * @returns 当前计费快照。
 */
export function readBillingSnapshot(store: TokenMonitorStore, handle: TokenMonitorSettingsHandle): BillingSnapshot {
  const state = store.get()
  return {
    revision: state.revision,
    rules: state.billing === undefined ? defaultBillingRules(handle.priceTable()) : validateBillingRules(state.billing),
  }
}

/** 组合根创建句柄的便捷出口，避免调用方重复拼装。 */
export function tokenMonitorSettingsHandle(ctx: Context, store: TokenMonitorStore): TokenMonitorSettingsHandle {
  // 活配置走 descriptor.value：宿主 fiber 的 config 在跨调用点时会读到空对象。
  return createSettingsHandle(() => liveUserConfig(ctx), store)
}

/** 供旧调用方读取一位 provider 的公开设置。 */
export function readHandleProvider(handle: TokenMonitorSettingsHandle, provider: string): ReturnType<typeof readProviderSettings> {
  return readProviderSettings(handle.user(), provider)
}
