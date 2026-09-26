import {
  parseTokenMonitorSettingsSnapshot,
  type TokenMonitorSettingsErrorCode,
  type TokenMonitorSettingsPatchRequest,
  type TokenMonitorSettingsSnapshot,
} from '@deepseek-ai/dsh-token-monitor-contract'
import { PRODUCT_NAME } from './branding.ts'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** HTTP error returned by the Token Monitor settings endpoint. */
export class TokenMonitorSettingsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: TokenMonitorSettingsErrorCode | 'HTTP_ERROR',
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message)
    this.name = 'TokenMonitorSettingsApiError'
  }
}

/** Protocol error raised when a settings response has an invalid shape. */
export class TokenMonitorSettingsProtocolError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super(PRODUCT_NAME + ' 设置接口返回了不符合契约的数据')
    this.name = 'TokenMonitorSettingsProtocolError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseErrorResponse(status: number, value: unknown): TokenMonitorSettingsApiError {
  if (!isRecord(value) || !isRecord(value.error)) {
    return new TokenMonitorSettingsApiError(status, 'HTTP_ERROR', `${PRODUCT_NAME} 设置请求失败（HTTP ${String(status)}）`)
  }
  const error = value.error
  const code = typeof error.code === 'string' ? error.code : 'HTTP_ERROR'
  const message = typeof error.message === 'string'
    ? error.message
    : `${PRODUCT_NAME} 设置请求失败（HTTP ${String(status)}）`
  const details = isRecord(error.details) ? error.details : undefined
  const rawFields = details !== undefined && isRecord(details.fields) ? details.fields : undefined
  const fields = rawFields === undefined
    ? undefined
    : Object.fromEntries(Object.entries(rawFields).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  const allowedCodes: readonly TokenMonitorSettingsErrorCode[] = [
    'METHOD_NOT_ALLOWED',
    'INVALID_JSON',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'VALIDATION_ERROR',
    'CONFLICT',
    'WRITE_FAILED',
  ]
  return new TokenMonitorSettingsApiError(
    status,
    allowedCodes.includes(code as TokenMonitorSettingsErrorCode) ? code as TokenMonitorSettingsErrorCode : 'HTTP_ERROR',
    message,
    fields,
  )
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    if (!response.ok) throw new TokenMonitorSettingsApiError(
      response.status,
      'HTTP_ERROR',
      `${PRODUCT_NAME} 设置请求失败（HTTP ${String(response.status)}）`,
    )
    throw new TokenMonitorSettingsProtocolError({ response: '响应不是有效 JSON' })
  }
}

async function parseResponse(response: Response): Promise<TokenMonitorSettingsSnapshot> {
  const value = await readJson(response)
  if (!response.ok) throw parseErrorResponse(response.status, value)
  const parsed = parseTokenMonitorSettingsSnapshot(value)
  if (!parsed.ok) throw new TokenMonitorSettingsProtocolError(parsed.fields)
  return parsed.value
}

/** Client operations supported by the Token Monitor settings endpoint. */
export interface TokenMonitorSettingsApi {
  get(signal?: AbortSignal): Promise<TokenMonitorSettingsSnapshot>
  patch(request: TokenMonitorSettingsPatchRequest, signal?: AbortSignal): Promise<TokenMonitorSettingsSnapshot>
}

/**
 * Browser-safe client for the dedicated Token Monitor settings endpoint.
 * @param fetcher - HTTP implementation used to read the Host endpoint.
 * @param endpoint - Settings endpoint URL.
 * @returns A settings API client bound to the supplied endpoint.
 */
export function createTokenMonitorSettingsApi(
  fetcher: FetchLike = fetch,
  endpoint = '/api/token-monitor/settings',
): TokenMonitorSettingsApi {
  let observed: TokenMonitorSettingsSnapshot | undefined
  const remember = (snapshot: TokenMonitorSettingsSnapshot) => { observed = snapshot; return snapshot }
  const read = async (signal?: AbortSignal) => remember(await parseResponse(await fetcher(endpoint, {
    cache: 'no-store', ...(signal === undefined ? {} : { signal }),
  })))
  const write = async (
    request: TokenMonitorSettingsPatchRequest, signal?: AbortSignal,
  ) => remember(await parseResponse(await fetcher(endpoint, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    cache: 'no-store', ...(signal === undefined ? {} : { signal }),
  })))
  return {
    get: read,
    async patch(request, signal) {
      const baseline = observed?.revision === request.expectedRevision ? observed : undefined
      try { return await write(request, signal) }
      catch (error) {
        if (!(error instanceof TokenMonitorSettingsApiError) || error.code !== 'CONFLICT' || !baseline) throw error
        const latest = await read(signal)
        const keys = Object.keys(request.patch) as Array<keyof typeof request.patch>
        if (keys.some(key => latest.settings[key] !== baseline.settings[key])) throw error
        // Retry once only when none of the fields being edited changed remotely.
        return write({ ...request, expectedRevision: latest.revision }, signal)
      }
    },
  }
}
