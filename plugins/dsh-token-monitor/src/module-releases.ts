/** Formal GitHub releases carry a manifest and one data-only gzip pack per owner. */
import { createHash } from 'node:crypto'
import { gunzip as decompress } from 'node:zlib'
import { promisify } from 'node:util'
import type { ModuleArtifact, ModuleReleaseManifest } from '@deepseek-ai/dsh-token-monitor-contract'
import { compareReleaseVersions, validReleaseVersion, validateManifest } from './module-files.ts'

const REPOSITORY = 'wssfk12138/dsh-damage-pulse'
const API = `https://api.github.com/repos/${REPOSITORY}/releases`
const MAX_BYTES = 250 * 1024 * 1024
const gunzip = promisify(decompress)
interface Asset { name: string; url: string; size: number; digest: string }
interface Release { version: string; assets: Asset[] }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export const artifactKey = (file: ModuleArtifact): string => `${file.root}/${file.path}`

/** Only fixed GitHub endpoints and their release-asset redirect host may receive requests. */
async function download(url: string, limit: number, signal: AbortSignal, fetcher: typeof fetch): Promise<Uint8Array> {
  let target = new URL(url)
  for (let redirects = 0; redirects < 4; redirects++) {
    const allowed = target.hostname === 'api.github.com' && target.pathname.startsWith(`/repos/${REPOSITORY}/releases`)
      || target.hostname === 'github.com' && target.pathname.startsWith(`/${REPOSITORY}/releases/download/`)
      || redirects > 0 && target.hostname === 'release-assets.githubusercontent.com'
    if (!allowed || target.protocol !== 'https:' || target.username || target.password || target.port || target.hash) throw new Error('RELEASE_URL_REFUSED')
    const response = await fetcher(target, { redirect: 'manual', signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-token-monitor-modules' } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location) throw new Error('RELEASE_REDIRECT_INVALID')
      target = new URL(location, target); continue
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`GITHUB_HTTP_${response.status}`) }
    const length = Number(response.headers.get('content-length') ?? 0)
    if (!Number.isFinite(length) || length > limit) { await response.body?.cancel(); throw new Error('RELEASE_RESPONSE_TOO_LARGE') }
    if (!response.body) throw new Error('RELEASE_RESPONSE_EMPTY')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const item = await reader.read()
        if (item.done) break
        size += item.value.length
        if (size > limit) throw new Error('RELEASE_RESPONSE_TOO_LARGE')
        chunks.push(item.value)
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    return Buffer.concat(chunks, size)
  }
  throw new Error('RELEASE_REDIRECT_LIMIT')
}

/** Every operation performs a fresh release lookup; callers cannot pick arbitrary versions. */
export class ModuleReleases {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 60_000) {}

  private async bytes(url: string, limit: number): Promise<Uint8Array> {
    return download(url, limit, AbortSignal.timeout(this.timeoutMs), this.fetcher)
  }

  async list(): Promise<Release[]> {
    const releases: Release[] = []
    for (let page = 1; page <= 100; page++) {
      const rows: unknown = JSON.parse(Buffer.from(await this.bytes(`${API}?per_page=100&page=${page}`, 8 * 1024 * 1024)).toString('utf8'))
      if (!Array.isArray(rows)) throw new Error('INVALID_GITHUB_RELEASE_LIST')
      for (const row of rows) {
        if (!object(row) || row.draft !== false || row.prerelease !== false || typeof row.tag_name !== 'string') continue
        const version = row.tag_name.replace(/^v/, '')
        if (!validReleaseVersion(version) || !Array.isArray(row.assets)) continue
        const assets = row.assets.flatMap((a): Asset[] => {
          if (!object(a) || typeof a.name !== 'string' || typeof a.browser_download_url !== 'string'
            || typeof a.size !== 'number' || !Number.isSafeInteger(a.size) || a.size < 0 || a.size > MAX_BYTES
            || typeof a.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(a.digest)) return []
          const url = new URL(a.browser_download_url)
          if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
            || !url.pathname.startsWith(`/${REPOSITORY}/releases/download/${encodeURIComponent(row.tag_name as string)}/`)) return []
          return [{ name: a.name, url: url.href, size: a.size, digest: a.digest.slice(7) }]
        })
        if (new Set(assets.map(a => a.name)).size !== assets.length || releases.some(r => r.version === version)) throw new Error('AMBIGUOUS_RELEASE')
        releases.push({ version, assets })
      }
      if (rows.length < 100) return releases.sort((a, b) => compareReleaseVersions(b.version, a.version))
    }
    throw new Error('GITHUB_RELEASE_LIST_TOO_LARGE')
  }

  private async asset(release: Release, name: string, limit: number): Promise<Uint8Array> {
    const asset = release.assets.find(a => a.name === name)
    if (!asset) throw new Error('MODULE_RELEASE_UNAVAILABLE')
    if (asset.size > limit) throw new Error('RELEASE_RESPONSE_TOO_LARGE')
    const bytes = await this.bytes(asset.url, limit)
    if (bytes.length !== asset.size || hash(bytes) !== asset.digest) throw new Error('RELEASE_DIGEST_MISMATCH')
    return bytes
  }

  async manifest(release: Release): Promise<ModuleReleaseManifest | undefined> {
    const name = `token-monitor-${release.version}.manifest.json`
    if (!release.assets.some(a => a.name === name)) return undefined
    const manifest = validateManifest(JSON.parse(Buffer.from(await this.asset(release, name, 8 * 1024 * 1024)).toString('utf8')))
    if (manifest.version !== release.version) throw new Error('RELEASE_VERSION_MISMATCH')
    return manifest
  }

  /** Download and verify all selected bytes before any service is stopped. */
  async prepare(release: Release, manifest: ModuleReleaseManifest, owners: string[]): Promise<Map<string, Uint8Array>> {
    const result = new Map<string, Uint8Array>()
    for (const owner of owners) {
      const files = owner === 'core' ? manifest.core : manifest.modules.find(m => m.id === owner)?.files
      if (!files) throw new Error('MODULE_NOT_IN_RELEASE')
      const pack = await this.asset(release, `token-monitor-${release.version}.${owner}.json.gz`, MAX_BYTES)
      const value: unknown = JSON.parse((await gunzip(pack, { maxOutputLength: 350 * 1024 * 1024 })).toString('utf8'))
      if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.files) || value.files.length !== files.length) throw new Error('INVALID_MODULE_PACK')
      const expected = new Map(files.map(f => [artifactKey(f), f]))
      for (const entry of value.files) {
        if (!object(entry) || typeof entry.key !== 'string' || typeof entry.data !== 'string') throw new Error('INVALID_MODULE_PACK')
        const file = expected.get(entry.key)
        if (!file || entry.data.length !== 4 * Math.ceil(file.size / 3)) throw new Error('INVALID_MODULE_PACK')
        const bytes = Buffer.from(entry.data, 'base64')
        if (bytes.length !== file.size || bytes.toString('base64') !== entry.data || hash(bytes) !== file.sha256) throw new Error('ARTIFACT_DIGEST_MISMATCH')
        result.set(entry.key, bytes); expected.delete(entry.key)
      }
      if (expected.size) throw new Error('INVALID_MODULE_PACK')
    }
    return result
  }
}
