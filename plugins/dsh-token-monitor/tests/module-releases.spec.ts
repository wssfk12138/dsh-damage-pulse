import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { expect, it, vi } from 'vitest'
import { ModuleReleases } from '../src/module-releases.ts'

const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
function fixture() {
  const bytes = Buffer.from('payload')
  const file = { root: 'host' as const, path: 'core.mjs', size: bytes.length, sha256: digest(bytes) }
  const manifest = { schemaVersion: 1 as const, version: '4.0.4', core: [file], modules: [] }
  const bodies = new Map<string, Uint8Array>([
    ['token-monitor-4.0.4.manifest.json', Buffer.from(JSON.stringify(manifest))],
    ['token-monitor-4.0.4.core.json.gz', gzipSync(JSON.stringify({ schemaVersion: 1, files: [{ key: 'host/core.mjs', data: bytes.toString('base64') }] }))],
  ])
  const release = { tag_name: 'v4.0.4', draft: false, prerelease: false, assets: [...bodies].map(([name, value]) => ({ name, size: value.length, digest: 'sha256:' + digest(value), browser_download_url: 'https://github.com/wssfk12138/dsh-damage-pulse/releases/download/v4.0.4/' + name })) }
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const target = new URL(String(url))
    return target.hostname === 'api.github.com' ? Response.json([release, { ...release, tag_name: 'v99.0.0', prerelease: true }, { ...release, tag_name: 'v98.0.0', draft: true }]) : new Response(Buffer.from(bodies.get(target.pathname.split('/').at(-1)!)!))
  })
  return { bytes, manifest, bodies, release, fetcher, service: new ModuleReleases(fetcher) }
}
it('accepts formal releases and verifies the manifest and every selected pack file', async () => {
  const f = fixture(), list = await f.service.list()
  expect(list.map(item => item.version)).toEqual(['4.0.4'])
  const manifest = await f.service.manifest(list[0]!)
  expect(manifest).toEqual(f.manifest)
  expect((await f.service.prepare(list[0]!, manifest!, ['core'])).get('host/core.mjs')).toEqual(f.bytes)
})
it('rejects changed download bytes before installation', async () => {
  const f = fixture(), list = await f.service.list()
  f.bodies.set('token-monitor-4.0.4.manifest.json', Buffer.from('{}'))
  await expect(f.service.manifest(list[0]!)).rejects.toThrow('RELEASE_DIGEST_MISMATCH')
})
it('refuses redirects to a non-GitHub download host', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/private' } }))
  await expect(new ModuleReleases(fetcher).list()).rejects.toThrow('RELEASE_URL_REFUSED')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('reports old releases without modular packages as unavailable', async () => {
  const f = fixture()
  f.release.assets = []
  const list = await f.service.list()
  expect(await f.service.manifest(list[0]!)).toBeUndefined()
  await expect(f.service.prepare(list[0]!, f.manifest, ['core'])).rejects.toThrow('MODULE_RELEASE_UNAVAILABLE')
})
it('rejects a valid gzip whose payload differs from the manifest hash', async () => {
  const f = fixture(), name = 'token-monitor-4.0.4.core.json.gz'
  const bytes = gzipSync(JSON.stringify({ schemaVersion: 1, files: [{ key: 'host/core.mjs', data: Buffer.from('changed').toString('base64') }] }))
  f.bodies.set(name, bytes)
  Object.assign(f.release.assets.find(a => a.name === name)!, { size: bytes.length, digest: 'sha256:' + digest(bytes) })
  const list = await f.service.list()
  await expect(f.service.prepare(list[0]!, f.manifest, ['core'])).rejects.toThrow('ARTIFACT_DIGEST_MISMATCH')
})
