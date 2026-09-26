type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Download metadata for one Token Monitor update asset. */
export interface TokenMonitorUpdateAsset {
  name: string
  size: number
  digest: string | null
}

/** Available Token Monitor update and its release metadata. */
export interface TokenMonitorUpdateStatus {
  repository: string
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseUrl: string
  asset: TokenMonitorUpdateAsset | null
}

/** Result returned after installing a Token Monitor update. */
export interface TokenMonitorInstallResult extends TokenMonitorUpdateStatus {
  installed: boolean
  staged: boolean
  stagedAsset?: string
  sha256?: string
  message: string
}

/** HTTP error returned by the Token Monitor update endpoint. */
export class TokenMonitorUpdateApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'TokenMonitorUpdateApiError'
  }
}

/** Protocol error raised when an update response has an invalid shape. */
export class TokenMonitorUpdateProtocolError extends Error {
  constructor(readonly field: string) {
    super(`更新接口返回了不符合契约的数据：${field}`)
    this.name = 'TokenMonitorUpdateProtocolError'
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown, max = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max }
function version(value: unknown): value is string { return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) }
function parseStatus(value: unknown): TokenMonitorUpdateStatus {
  if (!record(value) || !text(value.repository, 200) || !version(value.currentVersion) || !version(value.latestVersion) || typeof value.hasUpdate !== 'boolean' || !text(value.releaseUrl, 500) || !record(value.asset) && value.asset !== null) throw new TokenMonitorUpdateProtocolError('status')
  let asset: TokenMonitorUpdateAsset | null = null
  if (value.asset !== null) {
    if (!text(value.asset.name, 200) || typeof value.asset.size !== 'number' || !Number.isSafeInteger(value.asset.size) || value.asset.size <= 0 || (value.asset.digest !== null && !text(value.asset.digest, 100))) throw new TokenMonitorUpdateProtocolError('status.asset')
    asset = { name: value.asset.name, size: value.asset.size, digest: value.asset.digest as string | null }
  }
  return {
    repository: value.repository, currentVersion: value.currentVersion, latestVersion: value.latestVersion,
    hasUpdate: value.hasUpdate, releaseUrl: value.releaseUrl, asset,
  }
}
async function readJson(response: Response): Promise<unknown> {
  try { return await response.json() } catch { throw new TokenMonitorUpdateProtocolError('response') }
}
async function parse<T>(response: Response, parser: (value: unknown) => T): Promise<T> {
  const value = await readJson(response)
  if (!response.ok) {
    const error = record(value) && record(value.error) ? value.error : undefined
    throw new TokenMonitorUpdateApiError(response.status, error && text(error.code, 80) ? error.code : 'HTTP_ERROR', error && text(error.message, 512) ? error.message : `更新请求失败（HTTP ${String(response.status)}）`)
  }
  return parser(value)
}
function parseInstall(value: unknown): TokenMonitorInstallResult {
  if (!record(value) || typeof value.installed !== 'boolean' || typeof value.staged !== 'boolean' || !text(value.message, 512)) throw new TokenMonitorUpdateProtocolError('install')
  const base = parseStatus(value)
  return {
    ...base,
    installed: value.installed,
    staged: value.staged,
    ...(text(value.stagedAsset, 200) ? { stagedAsset: value.stagedAsset } : {}),
    ...(text(value.sha256, 100) ? { sha256: value.sha256 } : {}),
    message: value.message,
  }
}
/** Client operations supported by the Token Monitor update endpoint. */
export interface TokenMonitorUpdateApi {
  check(signal?: AbortSignal): Promise<TokenMonitorUpdateStatus>
  install(signal?: AbortSignal): Promise<TokenMonitorInstallResult>
}
/**
 * Create a client for checking and installing Token Monitor updates.
 * @param fetcher - HTTP implementation used to read the Host endpoint.
 * @param basePath - Base path of the update endpoint.
 * @returns An update API client bound to the supplied base path.
 */
export function createTokenMonitorUpdateApi(fetcher: FetchLike = fetch, basePath = '/api/token-monitor/update'): TokenMonitorUpdateApi {
  return {
    async check(signal) { return parse(await fetcher(basePath, { cache: 'no-store', ...(signal === undefined ? {} : { signal }) }), parseStatus) },
    async install(signal) { return parse(await fetcher(`${basePath}/install`, { method: 'POST', cache: 'no-store', ...(signal === undefined ? {} : { signal }) }), parseInstall) },
  }
}
