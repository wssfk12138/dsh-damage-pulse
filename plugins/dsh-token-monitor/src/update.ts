import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const UPDATE_STATUS_PATH = '/api/token-monitor/update'
export const UPDATE_INSTALL_PATH = '/api/token-monitor/update/install'
export const UPDATE_REPOSITORY = 'wssfk12138/dsh-damage-pulse'
export const CURRENT_RELEASE_VERSION = '4.0.4'
const RELEASES_API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`
const ASSET_HOST = 'github.com'
const REDIRECT_HOSTS = new Set(['release-assets.githubusercontent.com'])
const ASSET_MAX_BYTES = 50 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 12_000
const DOWNLOAD_TIMEOUT_MS = 30_000
const INSTALL_TIMEOUT_MS = 5 * 60_000
const INSTALL_REQUEST_MAX_BYTES = 8 * 1024
const ASSET_NAME = /^dsh-damage-pulse-v?(\d+\.\d+\.\d+)\.tgz$/
const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/i
const PROFILE_NAME = /^(?!node_modules$)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

type ReleaseAsset = { name: string; size: number; digest?: string; browser_download_url: string }
type ReleaseInfo = { tag_name: string; html_url: string; assets: ReleaseAsset[] }
type UpdateStatus = {
  repository: string
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseUrl: string
  asset: { name: string; size: number; digest: string } | null
}

interface UpdateRuntime {
  argv: readonly string[]
  execArgv: readonly string[]
  execPath: string
}

interface RegisterUpdateOptions {
  runtime?: UpdateRuntime
  installPackage?: (profile: string, packagePath: string) => Promise<void>
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

function semver(value: string): string | undefined {
  return /^v?(\d+\.\d+\.\d+)$/.exec(value.trim())?.[1]
}

function newer(left: string, right: string): boolean {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }
  return false
}

function assertRelease(value: unknown): ReleaseInfo {
  if (typeof value !== 'object' || value === null) throw new Error('GitHub release 响应无效')
  const record = value as Record<string, unknown>
  if (typeof record.tag_name !== 'string' || typeof record.html_url !== 'string' || !Array.isArray(record.assets)) {
    throw new Error('GitHub release 响应字段缺失')
  }
  const releaseUrl = new URL(record.html_url)
  if (releaseUrl.protocol !== 'https:' || releaseUrl.hostname !== ASSET_HOST
    || !releaseUrl.pathname.startsWith(`/${UPDATE_REPOSITORY}/releases/`)) {
    throw new Error('GitHub release 地址不在允许范围内')
  }
  const assets = record.assets.flatMap((asset): ReleaseAsset[] => {
    if (typeof asset !== 'object' || asset === null) return []
    const item = asset as Record<string, unknown>
    if (typeof item.name !== 'string' || typeof item.size !== 'number'
      || typeof item.browser_download_url !== 'string') return []
    const digest = typeof item.digest === 'string' && SHA256_DIGEST.test(item.digest) ? item.digest : undefined
    return [{ name: item.name, size: item.size, ...(digest === undefined ? {} : { digest }), browser_download_url: item.browser_download_url }]
  })
  return { tag_name: record.tag_name, html_url: releaseUrl.href, assets }
}

async function fetchJson(): Promise<ReleaseInfo> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(RELEASES_API, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-damage-pulse-updater' },
    })
    if (!response.ok) throw new Error(`GitHub 返回 HTTP ${String(response.status)}`)
    return assertRelease(await response.json())
  } finally { clearTimeout(timer) }
}

function selectAsset(release: ReleaseInfo): ReleaseAsset | undefined {
  const releaseVersion = semver(release.tag_name)
  if (releaseVersion === undefined) return undefined
  return release.assets.find(asset => {
    const match = ASSET_NAME.exec(asset.name)
    return match !== null && match[1] === releaseVersion && asset.size > 0 && asset.size <= ASSET_MAX_BYTES && asset.digest !== undefined
  })
}

function statusFrom(release: ReleaseInfo): UpdateStatus {
  const latestVersion = semver(release.tag_name)
  if (latestVersion === undefined) throw new Error('GitHub Release 版本号无效')
  const asset = selectAsset(release)
  return {
    repository: UPDATE_REPOSITORY,
    currentVersion: CURRENT_RELEASE_VERSION,
    latestVersion,
    hasUpdate: newer(latestVersion, CURRENT_RELEASE_VERSION),
    releaseUrl: release.html_url,
    asset: asset === undefined ? null : { name: asset.name, size: asset.size, digest: asset.digest! },
  }
}

async function statusPayload(): Promise<UpdateStatus> {
  return statusFrom(await fetchJson())
}

function assertInitialAssetUrl(asset: ReleaseAsset): URL {
  const url = new URL(asset.browser_download_url)
  if (url.protocol !== 'https:' || url.hostname !== ASSET_HOST
    || !url.pathname.startsWith(`/${UPDATE_REPOSITORY}/releases/download/`)
    || !url.pathname.endsWith(`/${asset.name}`)) throw new Error('更新资产来源不在允许范围内')
  return url
}

async function downloadAsset(asset: ReleaseAsset): Promise<Uint8Array> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  let url = assertInitialAssetUrl(asset)
  try {
    for (let redirect = 0; redirect <= 2; redirect += 1) {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': 'dsh-damage-pulse-updater' },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (location === null || redirect === 2) throw new Error('更新资产重定向无效')
        const next = new URL(location, url)
        if (next.protocol !== 'https:' || !REDIRECT_HOSTS.has(next.hostname)) throw new Error('更新资产重定向不在允许范围内')
        url = next
        continue
      }
      if (!response.ok) throw new Error(`更新资产下载失败（HTTP ${String(response.status)}）`)
      const length = Number(response.headers.get('content-length') ?? '0')
      if (length > ASSET_MAX_BYTES) throw new Error('更新资产超过大小限制')
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength === 0 || bytes.byteLength > ASSET_MAX_BYTES) throw new Error('更新资产大小无效')
      return bytes
    }
    throw new Error('更新资产重定向次数过多')
  } finally { clearTimeout(timer) }
}

export function inferRunningProfile(argv: readonly string[]): string | undefined {
  const args = argv.slice(2)
  if (args[0] === 'web') return 'web'
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--profile') {
      const profile = args[index + 1]
      return profile !== undefined && PROFILE_NAME.test(profile) ? profile : undefined
    }
    if (argument.startsWith('--profile=')) {
      const profile = argument.slice('--profile='.length)
      return PROFILE_NAME.test(profile) ? profile : undefined
    }
    if (argument === '--patch') { index += 1; continue }
    if (argument === '--dump-config' || argument === '--dump-default-config') continue
    break
  }
  return undefined
}

function loaderArgs(execArgv: readonly string[], cliEntry: string): string[] {
  if (!cliEntry.toLowerCase().endsWith('.ts')) return []
  const result: string[] = []
  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index]
    if (argument === '--import' || argument === '--loader') {
      const value = execArgv[index + 1]
      if (value !== undefined && value.length <= 256) { result.push(argument, value); index += 1 }
    } else if (/^--(?:import|loader)=.{1,256}$/.test(argument)) result.push(argument)
  }
  if (result.length === 0) throw new Error('当前源码运行方式缺少 TypeScript loader，无法启动官方安装器')
  return result
}

function runOfficialInstall(runtime: UpdateRuntime, profile: string, packagePath: string): Promise<void> {
  const cliEntry = runtime.argv[1]
  if (cliEntry === undefined || !path.isAbsolute(cliEntry)) throw new Error('无法定位当前 DSH CLI 入口')
  const args = [...loaderArgs(runtime.execArgv, cliEntry), cliEntry, 'plugin', '--profile', profile, 'add', packagePath]
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.execPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let diagnostics = ''
    const collect = (chunk: Buffer): void => { diagnostics = `${diagnostics}${chunk.toString('utf8')}`.slice(-8192) }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => { child.kill(); reject(new Error('官方插件安装超时，更新包已保留')) }, INSTALL_TIMEOUT_MS)
    child.once('error', cause => { clearTimeout(timer); reject(cause) })
    child.once('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`官方插件安装失败（退出码 ${String(code ?? 'unknown')}）${diagnostics.trim() === '' ? '' : `：${diagnostics.trim()}`}`))
    })
  })
}

async function installLatest(options: RegisterUpdateOptions): Promise<Record<string, unknown>> {
  const release = await fetchJson()
  const status = statusFrom(release)
  const asset = selectAsset(release)
  if (asset === undefined) throw new Error('最新 Release 没有带 SHA-256 摘要的插件资产')
  if (!status.hasUpdate) return { ...status, installed: false, staged: false, message: '当前已经是最新版本。' }
  const bytes = await downloadAsset(asset)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (asset.digest === undefined || asset.digest.toLowerCase() !== `sha256:${digest}`) throw new Error('更新资产 SHA-256 校验失败')
  const root = path.join(os.tmpdir(), 'dsh-damage-pulse-updates')
  await mkdir(root, { recursive: true })
  const target = path.join(root, asset.name)
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  try { await writeFile(temp, bytes, { flag: 'wx' }); await rename(temp, target) }
  catch (cause) { await rm(temp, { force: true }); throw cause }

  const runtime = options.runtime ?? { argv: process.argv, execArgv: process.execArgv, execPath: process.execPath }
  const profile = inferRunningProfile(runtime.argv)
  if (profile === undefined) throw new Error('更新包已下载并校验，但无法可靠识别当前 DSH profile；未执行安装')
  const installPackage = options.installPackage ?? ((name, packagePath) => runOfficialInstall(runtime, name, packagePath))
  await installPackage(profile, target)
  return {
    ...status,
    hasUpdate: false,
    installed: true,
    staged: true,
    stagedAsset: asset.name,
    sha256: digest,
    profile,
    message: `v${status.latestVersion} 已安装到 ${profile} profile，重启 DSH 后生效。`,
  }
}

function requestOriginAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const referer = request.headers.referer
  if (origin === undefined && referer === undefined) return true
  const host = request.headers.host
  if (host === undefined || host.trim() === '') return false
  const allowed = new Set([`http://${host}`, `https://${host}`])
  for (const value of [origin, referer]) {
    if (value === undefined) continue
    try {
      const url = new URL(value)
      if (!allowed.has(url.origin)) return false
    } catch {
      return false
    }
  }
  return true
}

async function bodyWithinLimit(request: IncomingMessage): Promise<boolean> {
  const declared = request.headers['content-length']
  if (declared !== undefined) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0 || length > INSTALL_REQUEST_MAX_BYTES) return false
  }
  let total = 0
  for await (const chunk of request) {
    total += Buffer.byteLength(chunk as Uint8Array)
    if (total > INSTALL_REQUEST_MAX_BYTES) return false
  }
  return true
}

export function registerUpdateRoutes(ctx: Context, options: RegisterUpdateOptions = {}): void {
  ctx.webServer.register({ kind: 'exact', path: UPDATE_STATUS_PATH, handler: async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return }
    try {
      const payload = await statusPayload()
      if (request.method === 'HEAD') { response.writeHead(200, { 'Cache-Control': 'no-store' }); response.end() }
      else json(response, 200, payload)
    } catch (cause) {
      json(response, 502, { error: { code: 'UPDATE_CHECK_FAILED', message: cause instanceof Error ? cause.message : '检查更新失败' } })
    }
  } })
  ctx.webServer.register({ kind: 'exact', path: UPDATE_INSTALL_PATH, handler: async (request, response) => {
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }); response.end(); return }
    if (!requestOriginAllowed(request)) {
      json(response, 403, { error: { code: 'UPDATE_INSTALL_FORBIDDEN', message: '更新请求来源不受信任' } })
      return
    }
    if (!await bodyWithinLimit(request)) {
      json(response, 413, { error: { code: 'UPDATE_INSTALL_BODY_TOO_LARGE', message: '更新请求体超过大小限制' } })
      return
    }
    try { json(response, 200, await installLatest(options)) }
    catch (cause) {
      json(response, 502, { error: { code: 'UPDATE_INSTALL_FAILED', message: cause instanceof Error ? cause.message : '安装更新失败' } })
    }
  } })
}
