import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createRouteGuard } from './http-trust.ts'

export const WECHAT_CONNECTION_BASE_PATH = '/api/token-monitor/wechat'
export const WECHAT_STATUS_PATH = `${WECHAT_CONNECTION_BASE_PATH}/status`
export const WECHAT_LOGIN_PATH = `${WECHAT_CONNECTION_BASE_PATH}/login`
export const WECHAT_LOGIN_CONFIRM_PATH = `${WECHAT_LOGIN_PATH}/confirm`
export const WECHAT_RECONNECT_PATH = `${WECHAT_CONNECTION_BASE_PATH}/reconnect`
export const WECHAT_DISCONNECT_PATH = `${WECHAT_CONNECTION_BASE_PATH}/disconnect`
export const WECHAT_TEST_PATH = `${WECHAT_CONNECTION_BASE_PATH}/test`
export const WECHAT_REQUEST_MAX_BODY_BYTES = 4 * 1_024

export type WechatConnectionServiceErrorCode =
  | 'UNSUPPORTED'
  | 'OPERATION_IN_PROGRESS'
  | 'LOGIN_SESSION_NOT_FOUND'
  | 'LOGIN_SESSION_EXPIRED'
  | 'LOGIN_PROTOCOL_ERROR'
  | 'NEEDS_LOGIN'
  | 'BRIDGE_NOT_OWNED'
  | 'CONFIRMATION_REQUIRED'
  | 'OPERATION_FAILED'

export interface WechatConnectionRouteService {
  status(): Promise<unknown>
  login(): Promise<unknown>
  confirmLogin(sessionId: string): Promise<unknown>
  reconnect(): Promise<unknown>
  disconnect(confirm: boolean): Promise<unknown>
  testMessage?(message: string): Promise<WechatTestMessageResult>
}

export type WechatTestMessageResult =
  | { ok: true }
  | { ok: false; code: 'activation-required' | 'send-failed'; detail: string }

type WechatRouteAction = 'status' | 'login' | 'confirm-login' | 'reconnect' | 'disconnect' | 'test-message'
type WechatRouteHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

type RouteErrorCode =
  | WechatConnectionServiceErrorCode
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_ERROR'
  | 'ACTIVATION_REQUIRED'
  | 'SEND_FAILED'

class WechatRequestError extends Error {
  constructor(readonly status: number, readonly code: RouteErrorCode, message: string) {
    super(message)
    this.name = 'WechatRequestError'
  }
}

const serviceErrorCodes: readonly WechatConnectionServiceErrorCode[] = [
  'UNSUPPORTED',
  'OPERATION_IN_PROGRESS',
  'LOGIN_SESSION_NOT_FOUND',
  'LOGIN_SESSION_EXPIRED',
  'LOGIN_PROTOCOL_ERROR',
  'NEEDS_LOGIN',
  'BRIDGE_NOT_OWNED',
  'CONFIRMATION_REQUIRED',
  'OPERATION_FAILED',
]

function sendJson(response: ServerResponse, status: number, value: unknown, head = false, headers: Record<string, string> = {}): void {
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
  code: RouteErrorCode,
  message: string,
  headers: Record<string, string> = {},
): void {
  sendJson(response, status, { error: { code, message } }, false, headers)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record)
  return actual.length === keys.length && actual.every(key => keys.includes(key))
}

function hasDangerousKey(record: Record<string, unknown>): boolean {
  return Object.keys(record).some(key => key === '__proto__' || key === 'prototype' || key === 'constructor')
}

function mediaType(request: IncomingMessage): string | undefined {
  return request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
}

async function readBodyText(request: IncomingMessage): Promise<string> {
  const contentLength = request.headers['content-length']
  if (contentLength !== undefined) {
    const declared = Number(contentLength)
    if (Number.isFinite(declared) && declared > WECHAT_REQUEST_MAX_BODY_BYTES) {
      request.resume()
      throw new WechatRequestError(413, 'PAYLOAD_TOO_LARGE', '请求体超过 4 KiB 限制')
    }
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > WECHAT_REQUEST_MAX_BODY_BYTES) {
      request.resume()
      throw new WechatRequestError(413, 'PAYLOAD_TOO_LARGE', '请求体超过 4 KiB 限制')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function requireEmptyBody(request: IncomingMessage): Promise<void> {
  if ((await readBodyText(request)).trim().length !== 0) {
    throw new WechatRequestError(400, 'VALIDATION_ERROR', '该操作不接受请求体')
  }
}

async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (mediaType(request) !== 'application/json') {
    throw new WechatRequestError(415, 'UNSUPPORTED_MEDIA_TYPE', '请求必须使用 application/json')
  }
  const text = await readBodyText(request)
  if (text.trim().length === 0) throw new WechatRequestError(400, 'INVALID_JSON', '请求体不能为空')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new WechatRequestError(400, 'INVALID_JSON', '请求体不是有效 JSON')
  }
  if (!isPlainObject(value) || hasDangerousKey(value)) {
    throw new WechatRequestError(400, 'VALIDATION_ERROR', '请求字段校验失败')
  }
  return value
}

async function readConfirmLogin(request: IncomingMessage): Promise<string> {
  const value = await readJsonObject(request)
  if (!hasExactKeys(value, ['sessionId']) || typeof value.sessionId !== 'string'
    || value.sessionId.length < 1 || value.sessionId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value.sessionId)) {
    throw new WechatRequestError(400, 'VALIDATION_ERROR', 'sessionId 无效')
  }
  return value.sessionId
}

async function readDisconnect(request: IncomingMessage): Promise<boolean> {
  const value = await readJsonObject(request)
  if (!hasExactKeys(value, ['confirm']) || typeof value.confirm !== 'boolean') {
    throw new WechatRequestError(400, 'VALIDATION_ERROR', 'confirm 必须是布尔值')
  }
  return value.confirm
}

async function readTestMessage(request: IncomingMessage): Promise<string> {
  const value = await readJsonObject(request)
  if (!hasExactKeys(value, ['message']) || typeof value.message !== 'string'
    || value.message.trim().length === 0 || value.message.length > 2_000) {
    throw new WechatRequestError(400, 'VALIDATION_ERROR', 'message 必须是 1–2000 个字符的非空文本')
  }
  return value.message
}

function serviceErrorStatus(code: WechatConnectionServiceErrorCode): number {
  switch (code) {
    case 'LOGIN_SESSION_NOT_FOUND': return 404
    case 'LOGIN_SESSION_EXPIRED': return 410
    case 'UNSUPPORTED': return 503
    case 'LOGIN_PROTOCOL_ERROR': return 502
    case 'OPERATION_IN_PROGRESS':
    case 'BRIDGE_NOT_OWNED':
    case 'NEEDS_LOGIN': return 409
    case 'CONFIRMATION_REQUIRED': return 400
    case 'OPERATION_FAILED': return 500
  }
}

function parseServiceError(error: unknown): { code: WechatConnectionServiceErrorCode; message: string } | undefined {
  if (!(error instanceof Error) || !('code' in error)) return undefined
  const code = error.code
  if (typeof code !== 'string' || !serviceErrorCodes.includes(code as WechatConnectionServiceErrorCode)) return undefined
  if (error.message.length < 1 || error.message.length > 512) return undefined
  return { code: code as WechatConnectionServiceErrorCode, message: error.message }
}

function allowedMethods(action: WechatRouteAction): string {
  return action === 'status' ? 'GET, HEAD' : 'POST'
}

/** Standalone handler seam shared by route registration and focused tests. */
export function createWechatConnectionRouteHandler(
  service: WechatConnectionRouteService,
  action: WechatRouteAction,
  reportInternalError: (error: unknown) => void = () => undefined,
): WechatRouteHandler {
  return async (request, response) => {
    const method = request.method ?? 'GET'
    const allow = allowedMethods(action)
    if ((action === 'status' && method !== 'GET' && method !== 'HEAD') || (action !== 'status' && method !== 'POST')) {
      sendError(response, 405, 'METHOD_NOT_ALLOWED', `仅支持 ${allow}`, { Allow: allow })
      return
    }

    try {
      let result: unknown
      switch (action) {
        case 'status': result = await service.status(); break
        case 'login': await requireEmptyBody(request); result = await service.login(); break
        case 'confirm-login': result = await service.confirmLogin(await readConfirmLogin(request)); break
        case 'reconnect': await requireEmptyBody(request); result = await service.reconnect(); break
        case 'disconnect': result = await service.disconnect(await readDisconnect(request)); break
        case 'test-message': {
          const message = await readTestMessage(request)
          if (service.testMessage === undefined) {
            sendError(response, 503, 'UNSUPPORTED', '微信测试消息能力当前不可用')
            return
          }
          const delivery = await service.testMessage(message)
          if (delivery.ok) {
            result = { ok: true }
            break
          }
          if (delivery.code === 'activation-required') {
            sendError(response, 409, 'ACTIVATION_REQUIRED', '微信通知通道需要先激活', { })
            return
          }
          sendError(response, 502, 'SEND_FAILED', '微信测试消息发送失败')
          return
        }
      }
      sendJson(response, 200, result, method === 'HEAD')
    } catch (error) {
      if (error instanceof WechatRequestError) {
        sendError(response, error.status, error.code, error.message)
        return
      }
      const serviceError = parseServiceError(error)
      if (serviceError !== undefined) {
        sendError(response, serviceErrorStatus(serviceError.code), serviceError.code, serviceError.message)
        return
      }
      reportInternalError(error)
      sendError(response, 500, 'OPERATION_FAILED', '微信连接操作失败，请稍后重试')
    }
  }
}

export function registerWechatRoutes(ctx: Context, service: WechatConnectionRouteService): void {
  const guard = createRouteGuard(ctx)
  const report = (_error: unknown) => {
    ctx.logger.warn('dsh-token-monitor wechat connection route failed')
  }
  const routes: ReadonlyArray<{ path: string; action: WechatRouteAction }> = [
    { path: WECHAT_STATUS_PATH, action: 'status' },
    { path: WECHAT_LOGIN_PATH, action: 'login' },
    { path: WECHAT_LOGIN_CONFIRM_PATH, action: 'confirm-login' },
    { path: WECHAT_RECONNECT_PATH, action: 'reconnect' },
    { path: WECHAT_DISCONNECT_PATH, action: 'disconnect' },
    { path: WECHAT_TEST_PATH, action: 'test-message' },
  ]
  for (const route of routes) {
    const handler = createWechatConnectionRouteHandler(service, route.action, report)
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: route.path,
      handler: (request, response) => {
        if (!guard(request, response)) return
        return handler(request, response)
      },
    }), `token-monitor: wechat ${route.action} route`)
  }
}
