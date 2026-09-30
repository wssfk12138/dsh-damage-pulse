import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { bootModules, selectBootManifest } from '../src/module-bootstrap.ts'

const manifest = (version: string, sha256: string) => ({ schemaVersion: 1, version, core: [{ root: 'host', path: 'core.mjs', size: 1, sha256 }], modules: [{ id: 'pet', files: [{ root: 'host', path: 'pet.mjs', size: 1, sha256 }] }] })

describe('installed payload preflight', () => {
  it('serves an authenticated tombstone snapshot when the core is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'token-monitor-removed-'))
    const pluginRoot = join(root, 'node_modules', 'token-monitor')
    const release = manifest('4.2.0', 'a'.repeat(64))
    const cleanups: Array<() => unknown> = []
    let handler: (req: any, res: any) => void = () => { throw new Error('route absent') }
    let rejection: 401 | undefined
    const ctx = {
      effect(factory: () => unknown) { const cleanup = factory(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => unknown) },
      inject(_keys: string[], callback: (scope: unknown) => void) { callback(ctx) },
      connection: { requestRejection: () => rejection },
      webServer: { register(route: { path: string; handler: typeof handler }) { expect(route.path).toBe('/api/token-monitor/modules'); handler = route.handler; return () => {} } },
    }
    try {
      await mkdir(join(pluginRoot, 'runtime'), { recursive: true })
      await mkdir(join(root, '.dsh-damage-pulse'))
      await writeFile(join(pluginRoot, 'runtime', 'manifest.json'), JSON.stringify(release))
      await writeFile(join(root, '.dsh-damage-pulse', 'module-state.json'), JSON.stringify({
        schemaVersion: 1, revision: 3, version: release.version, removed: {}, restartRequired: false,
        manifest: release, wholePlugin: { preserveData: true, pending: false, erased: true },
      }))
      await bootModules(ctx as unknown as Context, pluginRoot, join(pluginRoot, 'runtime', 'client'))
      const response = () => ({ status: 0, body: '', writeHead(status: number) { this.status = status }, end(body = '') { this.body = body } })
      const accepted = response(); handler({ method: 'GET', headers: {} }, accepted)
      expect(accepted.status).toBe(200)
      expect(JSON.parse(accepted.body)).toMatchObject({ pluginRemoved: true, modules: [{ id: 'pet', status: 'removed' }] })
      rejection = 401
      const rejected = response(); handler({ method: 'GET', headers: {} }, rejected)
      expect(rejected.status).toBe(401)
      expect(rejected.body).toBe('unauthorized')
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the persisted release manifest after an in-place core update', () => {
    const selected = selectBootManifest(manifest('4.0.3', 'a'.repeat(64)), manifest('4.0.4', 'b'.repeat(64)))
    expect(selected.version).toBe('4.0.4')
    expect(selected.core[0]?.sha256).toBe('b'.repeat(64))
  })

  it('uses the package manifest when a package-manager upgrade is newer', () => {
    const selected = selectBootManifest(manifest('4.0.4', 'b'.repeat(64)), manifest('4.0.3', 'a'.repeat(64)))
    expect(selected.version).toBe('4.0.4')
    expect(selected.core[0]?.sha256).toBe('b'.repeat(64))
  })

  it('names the missing generated payload instead of surfacing a bare ENOENT', async () => {
    const pluginRoot = await mkdtemp(join(tmpdir(), 'token-monitor-boot-'))
    try {
      // A source install never runs the packaging step, so runtime/ is absent.
      // The preflight must reject before it creates the profile state directory.
      await expect(bootModules({} as unknown as Context, pluginRoot, pluginRoot)).rejects.toThrow(/runtime[\\/]manifest\.json/u)
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })
})
