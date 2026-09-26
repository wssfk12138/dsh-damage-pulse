type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Whether the Host supports managed WeChat notifications. */
export type WechatAvailability = 'available' | 'unsupported'
/** Authentication state reported by the managed WeChat runtime. */
export type WechatAuthState = 'unconfigured' | 'pending' | 'authenticated' | 'expired' | 'unknown'
/** Ownership and liveness state of the WeChat helper process. */
export type WechatProcessState = 'host-managed-running' | 'host-managed-stopped' | 'external' | 'none' | 'unknown'
/** Whether the WeChat helper can currently deliver notifications. */
export type WechatDeliveryState = 'ready' | 'needs-activation' | 'not-ready' | 'unknown'
/** Connection operation currently running in the settings UI. */
export type WechatConnectionOperation = 'idle' | 'login' | 'confirm-login' | 'reconnect' | 'disconnect'
/** Successful result returned after sending a WeChat test notification. */
export type WechatTestMessageResult = { ok: true }

/** Combined Host, authentication, process, and delivery state for WeChat notifications. */
export interface WechatRuntimeStatus {
  schemaVersion: 1
  provider: 'clawbot-wechat'
  availability: WechatAvailability
  auth: WechatAuthState
  process: WechatProcessState
  delivery: WechatDeliveryState
  operation: WechatConnectionOperation
  capabilities: { canLogin: boolean; canReconnect: boolean; canDisconnect: boolean }
  pendingLogin?: { sessionId: string; phase: 'waiting' | 'scanned'; expiresAt: number }
  identity?: { maskedUserId: string }
  lastError?: { code: string; message: string }
  checkedAt: number
}

/** Login attempt started by the Host, including any QR-code payload. */
export interface WechatLoginStart {
  login: { sessionId: string; expiresAt: number; qrPayload: string }
  status: WechatRuntimeStatus
}

/** Result returned after confirming a WeChat login attempt. */
export interface WechatLoginConfirmation {
  result: 'waiting' | 'scanned' | 'confirmed' | 'expired'
  status: WechatRuntimeStatus
}

/** Stable error codes returned by WeChat connection operations. */
export type WechatConnectionApiErrorCode =
  | 'UNSUPPORTED'
  | 'OPERATION_IN_PROGRESS'
  | 'LOGIN_SESSION_NOT_FOUND'
  | 'LOGIN_SESSION_EXPIRED'
  | 'LOGIN_PROTOCOL_ERROR'
  | 'NEEDS_LOGIN'
  | 'BRIDGE_NOT_OWNED'
  | 'CONFIRMATION_REQUIRED'
  | 'OPERATION_FAILED'
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_ERROR'
  | 'ACTIVATION_REQUIRED'
  | 'SEND_FAILED'
  | 'HTTP_ERROR'

/** HTTP error returned by the WeChat connection endpoint. */
export class WechatConnectionApiError extends Error {
  constructor(readonly status: number, readonly code: WechatConnectionApiErrorCode, message: string) {
    super(message)
    this.name = 'WechatConnectionApiError'
  }
}

/** Protocol error raised when a WeChat connection response has an invalid shape. */
export class WechatConnectionProtocolError extends Error {
  constructor(readonly field: string) {
    super(`微信连接接口返回了不符合契约的数据：${field}`)
    this.name = 'WechatConnectionProtocolError'
  }
}

const availabilityValues: readonly WechatAvailability[] = ['available', 'unsupported']
const authValues: readonly WechatAuthState[] = ['unconfigured', 'pending', 'authenticated', 'expired', 'unknown']
const processValues: readonly WechatProcessState[] = ['host-managed-running', 'host-managed-stopped', 'external', 'none', 'unknown']
const deliveryValues: readonly WechatDeliveryState[] = ['ready', 'needs-activation', 'not-ready', 'unknown']
const operationValues: readonly WechatConnectionOperation[] = ['idle', 'login', 'confirm-login', 'reconnect', 'disconnect']
const knownErrorCodes: readonly Exclude<WechatConnectionApiErrorCode, 'HTTP_ERROR'>[] = [
  'UNSUPPORTED', 'OPERATION_IN_PROGRESS', 'LOGIN_SESSION_NOT_FOUND', 'LOGIN_SESSION_EXPIRED',
  'LOGIN_PROTOCOL_ERROR', 'NEEDS_LOGIN', 'BRIDGE_NOT_OWNED', 'CONFIRMATION_REQUIRED', 'OPERATION_FAILED',
  'METHOD_NOT_ALLOWED', 'INVALID_JSON', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'VALIDATION_ERROR',
  'ACTIVATION_REQUIRED', 'SEND_FAILED',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exact(record: Record<string, unknown>, required: readonly string[], _optional: readonly string[] = []): boolean {
  // Ignore unknown fields so Host can add optional response metadata without
  // breaking older Clients; parsers still copy only known validated fields.
  return required.every(key => Object.prototype.hasOwnProperty.call(record, key))
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseStatus(value: unknown): WechatRuntimeStatus {
  if (!isRecord(value) || !exact(value, [
    'schemaVersion', 'provider', 'availability', 'auth', 'process', 'delivery', 'operation', 'capabilities', 'checkedAt',
  ], ['pendingLogin', 'identity', 'lastError'])) throw new WechatConnectionProtocolError('status')
  if (value.schemaVersion !== 1 || value.provider !== 'clawbot-wechat'
    || !availabilityValues.includes(value.availability as WechatAvailability)
    || !authValues.includes(value.auth as WechatAuthState)
    || !processValues.includes(value.process as WechatProcessState)
    || !deliveryValues.includes(value.delivery as WechatDeliveryState)
    || !operationValues.includes(value.operation as WechatConnectionOperation)
    || !timestamp(value.checkedAt)) throw new WechatConnectionProtocolError('status')

  const capabilities = value.capabilities
  if (!isRecord(capabilities) || !exact(capabilities, ['canLogin', 'canReconnect', 'canDisconnect'])
    || typeof capabilities.canLogin !== 'boolean' || typeof capabilities.canReconnect !== 'boolean'
    || typeof capabilities.canDisconnect !== 'boolean') throw new WechatConnectionProtocolError('status.capabilities')

  let pendingLogin: WechatRuntimeStatus['pendingLogin']
  if (value.pendingLogin !== undefined) {
    const pending = value.pendingLogin
    if (!isRecord(pending) || !exact(pending, ['sessionId', 'phase', 'expiresAt'])
      || !boundedString(pending.sessionId, 128) || (pending.phase !== 'waiting' && pending.phase !== 'scanned')
      || !timestamp(pending.expiresAt)) throw new WechatConnectionProtocolError('status.pendingLogin')
    pendingLogin = { sessionId: pending.sessionId, phase: pending.phase, expiresAt: pending.expiresAt }
  }

  let identity: WechatRuntimeStatus['identity']
  if (value.identity !== undefined) {
    if (!isRecord(value.identity) || !exact(value.identity, ['maskedUserId'])
      || typeof value.identity.maskedUserId !== 'string'
      || (value.identity.maskedUserId !== '***' && !/^.{4}\*{3}.{4}$/u.test(value.identity.maskedUserId))) {
      throw new WechatConnectionProtocolError('status.identity')
    }
    identity = { maskedUserId: value.identity.maskedUserId }
  }

  let lastError: WechatRuntimeStatus['lastError']
  if (value.lastError !== undefined) {
    if (!isRecord(value.lastError) || !exact(value.lastError, ['code', 'message'])
      || !boundedString(value.lastError.code, 128) || !boundedString(value.lastError.message, 512)) {
      throw new WechatConnectionProtocolError('status.lastError')
    }
    lastError = { code: value.lastError.code, message: value.lastError.message }
  }

  return {
    schemaVersion: 1,
    provider: 'clawbot-wechat',
    availability: value.availability as WechatAvailability,
    auth: value.auth as WechatAuthState,
    process: value.process as WechatProcessState,
    delivery: value.delivery as WechatDeliveryState,
    operation: value.operation as WechatConnectionOperation,
    capabilities: {
      canLogin: capabilities.canLogin,
      canReconnect: capabilities.canReconnect,
      canDisconnect: capabilities.canDisconnect,
    },
    ...(pendingLogin === undefined ? {} : { pendingLogin }),
    ...(identity === undefined ? {} : { identity }),
    ...(lastError === undefined ? {} : { lastError }),
    checkedAt: value.checkedAt,
  }
}

function parseLogin(value: unknown): WechatLoginStart {
  if (!isRecord(value) || !exact(value, ['login', 'status']) || !isRecord(value.login)
    || !exact(value.login, ['sessionId', 'expiresAt', 'qrPayload'])
    || !boundedString(value.login.sessionId, 128) || !timestamp(value.login.expiresAt)
    || !boundedString(value.login.qrPayload, 16_384)) throw new WechatConnectionProtocolError('login')
  return {
    login: { sessionId: value.login.sessionId, expiresAt: value.login.expiresAt, qrPayload: value.login.qrPayload },
    status: parseStatus(value.status),
  }
}

function parseConfirmation(value: unknown): WechatLoginConfirmation {
  if (!isRecord(value) || !exact(value, ['result', 'status'])
    || (value.result !== 'waiting' && value.result !== 'scanned' && value.result !== 'confirmed' && value.result !== 'expired')) {
    throw new WechatConnectionProtocolError('confirmation')
  }
  return { result: value.result, status: parseStatus(value.status) }
}

function parseTestMessage(value: unknown): WechatTestMessageResult {
  if (!isRecord(value) || !exact(value, ['ok']) || value.ok !== true) {
    throw new WechatConnectionProtocolError('test-message')
  }
  return { ok: true }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    if (response.ok) throw new WechatConnectionProtocolError('response')
    throw new WechatConnectionApiError(response.status, 'HTTP_ERROR', `微信连接请求失败（HTTP ${String(response.status)}）`)
  }
}

function parseError(response: Response, value: unknown): WechatConnectionApiError {
  const fallback = `微信连接请求失败（HTTP ${String(response.status)}）`
  if (!isRecord(value) || !exact(value, ['error']) || !isRecord(value.error)
    || !exact(value.error, ['code', 'message']) || typeof value.error.code !== 'string'
    || !knownErrorCodes.includes(value.error.code as Exclude<WechatConnectionApiErrorCode, 'HTTP_ERROR'>)
    || !boundedString(value.error.message, 512)) {
    return new WechatConnectionApiError(response.status, 'HTTP_ERROR', fallback)
  }
  return new WechatConnectionApiError(
    response.status,
    value.error.code as Exclude<WechatConnectionApiErrorCode, 'HTTP_ERROR'>,
    value.error.message,
  )
}

async function parseResponse<T>(response: Response, parser: (value: unknown) => T): Promise<T> {
  const value = await readJson(response)
  if (!response.ok) throw parseError(response, value)
  return parser(value)
}

/** Client operations supported by the WeChat connection endpoint. */
export interface WechatConnectionApi {
  status(signal?: AbortSignal): Promise<WechatRuntimeStatus>
  login(signal?: AbortSignal): Promise<WechatLoginStart>
  confirmLogin(sessionId: string, signal?: AbortSignal): Promise<WechatLoginConfirmation>
  reconnect(signal?: AbortSignal): Promise<WechatRuntimeStatus>
  disconnect(signal?: AbortSignal): Promise<WechatRuntimeStatus>
  testMessage(message: string, signal?: AbortSignal): Promise<WechatTestMessageResult>
}

function signalInit(signal: AbortSignal | undefined): Pick<RequestInit, 'signal'> {
  return signal === undefined ? {} : { signal }
}

/**
 * Create a client for Host-managed WeChat connection operations.
 * @param fetcher - HTTP implementation used to read the Host endpoint.
 * @param basePath - Base path of the update endpoint.
 * @returns A WeChat connection API client bound to the supplied base path.
 */
export function createWechatConnectionApi(
  fetcher: FetchLike = fetch,
  basePath = '/api/token-monitor/wechat',
): WechatConnectionApi {
  return {
    async status(signal) {
      return parseResponse(await fetcher(`${basePath}/status`, { cache: 'no-store', ...signalInit(signal) }), parseStatus)
    },
    async login(signal) {
      return parseResponse(await fetcher(`${basePath}/login`, { method: 'POST', cache: 'no-store', ...signalInit(signal) }), parseLogin)
    },
    async confirmLogin(sessionId, signal) {
      return parseResponse(await fetcher(`${basePath}/login/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }),
        cache: 'no-store', ...signalInit(signal),
      }), parseConfirmation)
    },
    async reconnect(signal) {
      return parseResponse(await fetcher(`${basePath}/reconnect`, { method: 'POST', cache: 'no-store', ...signalInit(signal) }), parseStatus)
    },
    async disconnect(signal) {
      return parseResponse(await fetcher(`${basePath}/disconnect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
        cache: 'no-store', ...signalInit(signal),
      }), parseStatus)
    },
    async testMessage(message, signal) {
      return parseResponse(await fetcher(`${basePath}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
        cache: 'no-store', ...signalInit(signal),
      }), parseTestMessage)
    },
  }
}
