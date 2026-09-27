import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_RELEASE_VERSION, inferRunningProfile, registerUpdateRoutes, UPDATE_INSTALL_PATH, UPDATE_STATUS_PATH } from '../src/update.ts'

/** Release fixtures stay relative to the running build so a version bump cannot silently close the install path. */
function shiftPatch(version: string, delta: number): string {
  const [major, minor, patch] = version.split('.').map(Number)
  const next = (patch ?? 0) + delta
    if (next >= 0) return `${String(major)}.${String(minor)}.${String(next)}`
    // Borrow one minor so an x.y.0 release still has a strictly lower fixture version.
    return `${String(major)}.${String(Math.max(0, (minor ?? 0) - 1))}.99`
}

const PRIOR_RELEASE = shiftPatch(CURRENT_RELEASE_VERSION, -1)
const NEWER_RELEASE = shiftPatch(CURRENT_RELEASE_VERSION, 1)

function releaseAsset(tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `dsh-damage-pulse-${tag}.tgz`,
    browser_download_url: `https://github.com/wssfk12138/dsh-damage-pulse/releases/download/${tag}/dsh-damage-pulse-${tag}.tgz`,
    ...extra,
  }
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllGlobals()
  while (disposers.length > 0) await disposers.pop()!()
})

async function serve(options: Parameters<typeof registerUpdateRoutes>[1] = {}) {
  const routes = new Map<string, (request: any, response: any) => Promise<void> | void>()
  registerUpdateRoutes({
    connection: { requestRejection: () => undefined },
    webServer: { register: (route: any) => routes.set(route.path, route.handler) },
  } as any, options)
  const server: Server = createServer((request, response) => {
    const handler = routes.get(new URL(request.url ?? '/', 'http://localhost').pathname)
    if (handler === undefined) { response.writeHead(404); response.end(); return }
    void Promise.resolve(handler(request, response)).catch(error => { response.writeHead(500); response.end(String(error)) })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  disposers.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

function githubRelease(version: string, overrides: Record<string, unknown> = {}) {
  const tag = `v${version}`
  return {
    tag_name: tag,
    html_url: `https://github.com/wssfk12138/dsh-damage-pulse/releases/tag/${tag}`,
    assets: [releaseAsset(tag, { size: 3, digest: 'sha256:ignored' })],
    ...overrides,
  }
}

describe('token monitor update Host routes', () => {
  it('serves a validated latest-release status and rejects unsupported methods', async () => {
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      return url.startsWith('https://api.github.com/')
        ? Promise.resolve(new Response(JSON.stringify(githubRelease(PRIOR_RELEASE)), { status: 200 }))
        : realFetch(input, init)
    }))
    const endpoint = `${await serve()}${UPDATE_STATUS_PATH}`
    const response = await fetch(endpoint)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ repository: 'wssfk12138/dsh-damage-pulse', currentVersion: CURRENT_RELEASE_VERSION, latestVersion: PRIOR_RELEASE, hasUpdate: false })
    const head = await fetch(endpoint, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const method = await fetch(endpoint, { method: 'POST' })
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('GET, HEAD')
  })

  it('accepts the real release asset naming without a v prefix', async () => {
    const release = githubRelease(NEWER_RELEASE, {
      assets: [releaseAsset(`v${NEWER_RELEASE}`, { name: `dsh-damage-pulse-${NEWER_RELEASE}.tgz`, size: 3, digest: `sha256:${'0'.repeat(64)}` })],
    })
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith('https://api.github.com/')
      ? Promise.resolve(new Response(JSON.stringify(release), { status: 200 }))
      : realFetch(input, init)))
    const response = await fetch(`${await serve()}${UPDATE_STATUS_PATH}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ latestVersion: NEWER_RELEASE, hasUpdate: true, asset: { name: `dsh-damage-pulse-${NEWER_RELEASE}.tgz` } })
  })

  it('reports no installable asset when the release digest is missing', async () => {
    const release = githubRelease(CURRENT_RELEASE_VERSION, {
      assets: [releaseAsset(`v${CURRENT_RELEASE_VERSION}`, { size: 3 })],
    })
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith('https://api.github.com/')
      ? Promise.resolve(new Response(JSON.stringify(release), { status: 200 }))
      : realFetch(input, init)))
    const endpoint = await serve()
    const status = await fetch(`${endpoint}${UPDATE_STATUS_PATH}`)
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ latestVersion: CURRENT_RELEASE_VERSION, asset: null })
    const install = await fetch(`${endpoint}${UPDATE_INSTALL_PATH}`, { method: 'POST' })
    expect(install.status).toBe(502)
    expect(await install.json()).toMatchObject({ error: { code: 'UPDATE_INSTALL_FAILED' } })
  })

  it('ignores assets with malformed digests', async () => {
    const release = githubRelease(CURRENT_RELEASE_VERSION, {
      assets: [releaseAsset(`v${CURRENT_RELEASE_VERSION}`, { size: 3, digest: 'sha256:short' })],
    })
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith('https://api.github.com/')
      ? Promise.resolve(new Response(JSON.stringify(release), { status: 200 }))
      : realFetch(input, init)))
    const response = await fetch(`${await serve()}${UPDATE_STATUS_PATH}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ latestVersion: CURRENT_RELEASE_VERSION, asset: null })
  })

  it('ignores assets whose version does not match the release tag', async () => {
    const release = githubRelease(CURRENT_RELEASE_VERSION, {
      assets: [releaseAsset(`v${CURRENT_RELEASE_VERSION}`, {
        name: `dsh-damage-pulse-v${PRIOR_RELEASE}.tgz`,
        browser_download_url: `https://github.com/wssfk12138/dsh-damage-pulse/releases/download/v${CURRENT_RELEASE_VERSION}/dsh-damage-pulse-v${PRIOR_RELEASE}.tgz`,
        size: 3,
        digest: `sha256:${'0'.repeat(64)}`,
      })],
    })
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith('https://api.github.com/')
      ? Promise.resolve(new Response(JSON.stringify(release), { status: 200 }))
      : realFetch(input, init)))
    const response = await fetch(`${await serve()}${UPDATE_STATUS_PATH}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ latestVersion: CURRENT_RELEASE_VERSION, asset: null })
  })

  it('rejects an oversized install request before checking GitHub', async () => {
    const realFetch = globalThis.fetch
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://api.github.com/')) return Promise.reject(new Error('GitHub should not be called'))
      return realFetch(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    const endpoint = `${await serve()}${UPDATE_INSTALL_PATH}`
    const response = await fetch(endpoint, { method: 'POST', body: 'x'.repeat(8 * 1024 + 1) })
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: { code: 'UPDATE_INSTALL_BODY_TOO_LARGE' } })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('https://'))).toHaveLength(0)
  })

  it('rejects cross-site install origins', async () => {
    const realFetch = globalThis.fetch
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://api.github.com/')) return Promise.reject(new Error('GitHub should not be called'))
      return realFetch(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    const endpoint = `${await serve()}${UPDATE_INSTALL_PATH}`
    const response = await fetch(endpoint, { method: 'POST', headers: { Origin: 'https://evil.example' } })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'UPDATE_INSTALL_FORBIDDEN' } })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('https://'))).toHaveLength(0)
  })

  it('rejects cross-site install referers', async () => {
    const realFetch = globalThis.fetch
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://api.github.com/')) return Promise.reject(new Error('GitHub should not be called'))
      return realFetch(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    const endpoint = `${await serve()}${UPDATE_INSTALL_PATH}`
    const response = await fetch(endpoint, { method: 'POST', headers: { Referer: 'https://evil.example/page' } })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'UPDATE_INSTALL_FORBIDDEN' } })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('https://'))).toHaveLength(0)
  })

  it('stages a newer asset only after size and digest validation', async () => {
    const bytes = new TextEncoder().encode('valid tgz fixture')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const assetName = `dsh-damage-pulse-v${NEWER_RELEASE}.tgz`
    const release = githubRelease(NEWER_RELEASE, {
      assets: [releaseAsset(`v${NEWER_RELEASE}`, { size: bytes.byteLength, digest: `sha256:${digest}` })],
    })
    const realFetch = globalThis.fetch
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://api.github.com/')) return Promise.resolve(new Response(JSON.stringify(release), { status: 200 }))
      if (url.startsWith('https://github.com/')) return Promise.resolve(new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } }))
      return realFetch(input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    const installed: Array<{ profile: string; packagePath: string }> = []
    const endpoint = `${await serve({ runtime: { argv: ['node', 'apps/cli/src/bin.ts', 'web'], execArgv: ['--import', 'tsx/esm'], execPath: 'node' }, installPackage: async (profile, packagePath) => { installed.push({ profile, packagePath }) } })}${UPDATE_INSTALL_PATH}`
    const response = await fetch(endpoint, { method: 'POST' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ latestVersion: NEWER_RELEASE, installed: true, staged: true, profile: 'web', stagedAsset: assetName, sha256: digest })
    expect(installed).toHaveLength(1)
    expect(installed[0]?.profile).toBe('web')
    expect(installed[0]?.packagePath.endsWith(assetName)).toBe(true)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('https://')).length).toBe(2)
    const method = await fetch(endpoint)
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('POST')
  })

  it('rejects a digest mismatch without staging', async () => {
    const release = githubRelease(NEWER_RELEASE, {
      assets: [releaseAsset(`v${NEWER_RELEASE}`, { size: 4, digest: 'sha256:0000' })],
    })
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://api.github.com/')) return Promise.resolve(new Response(JSON.stringify(release), { status: 200 }))
      if (url.startsWith('https://github.com/')) return Promise.resolve(new Response(new TextEncoder().encode('bad!'), { status: 200 }))
      return realFetch(input, init)
    }))
    const response = await fetch(`${await serve()}${UPDATE_INSTALL_PATH}`, { method: 'POST' })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: { code: 'UPDATE_INSTALL_FAILED' } })
  })

  it('recognizes supported DSH profile argument forms only', () => {
    expect(inferRunningProfile(['node', 'bin.ts', 'web'])).toBe('web')
    expect(inferRunningProfile(['node', 'bin.ts', '--profile', 'headless', 'task'])).toBe('headless')
    expect(inferRunningProfile(['node', 'bin.ts', '--profile=desktop'])).toBe('desktop')
    expect(inferRunningProfile(['node', 'bin.ts', '--patch', 'file.yml', 'web'])).toBeUndefined()
    expect(inferRunningProfile(['node', 'bin.ts', '--profile', 'node_modules'])).toBeUndefined()
  })

  it('does not invoke installation when profile cannot be identified', async () => {
    const bytes = new TextEncoder().encode('valid tgz fixture')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const release = githubRelease(NEWER_RELEASE, {
      assets: [releaseAsset(`v${NEWER_RELEASE}`, { size: bytes.byteLength, digest: `sha256:${digest}` })],
    })
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://api.github.com/')) return Promise.resolve(new Response(JSON.stringify(release), { status: 200 }))
      if (url.startsWith('https://github.com/')) return Promise.resolve(new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } }))
      return realFetch(input, init)
    }))
    const installPackage = vi.fn(async () => undefined)
    const response = await fetch(`${await serve({ runtime: { argv: ['node', 'bin.ts', 'unknown-command'], execArgv: [], execPath: 'node' }, installPackage })}${UPDATE_INSTALL_PATH}`, { method: 'POST' })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: { code: 'UPDATE_INSTALL_FAILED', message: expect.stringContaining('无法可靠识别') } })
    expect(installPackage).not.toHaveBeenCalled()
  })

  it('rejects redirects outside GitHub release asset hosts', async () => {
    const bytes = new TextEncoder().encode('valid tgz fixture')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const release = githubRelease(NEWER_RELEASE, {
      assets: [releaseAsset(`v${NEWER_RELEASE}`, { size: bytes.byteLength, digest: `sha256:${digest}` })],
    })
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://api.github.com/')) return Promise.resolve(new Response(JSON.stringify(release), { status: 200 }))
      if (url.startsWith('https://github.com/')) return Promise.resolve(new Response(null, { status: 302, headers: { location: 'https://example.com/asset.tgz' } }))
      return realFetch(input, init)
    }))
    const response = await fetch(`${await serve({ runtime: { argv: ['node', 'bin.ts', 'web'], execArgv: [], execPath: 'node' }, installPackage: async () => undefined })}${UPDATE_INSTALL_PATH}`, { method: 'POST' })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: { code: 'UPDATE_INSTALL_FAILED', message: expect.stringContaining('重定向不在允许范围') } })
  })
})
