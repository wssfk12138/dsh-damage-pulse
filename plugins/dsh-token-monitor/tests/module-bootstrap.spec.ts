import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { bootModules, selectBootManifest } from '../src/module-bootstrap.ts'

const manifest = (version: string, sha256: string) => ({ schemaVersion: 1, version, core: [{ root: 'host', path: 'core.mjs', size: 1, sha256 }], modules: [{ id: 'pet', files: [{ root: 'host', path: 'pet.mjs', size: 1, sha256 }] }] })

describe('installed payload preflight', () => {
  it.each(['complete', 'partial', 'pending-core', 'pending-module'])('handles %s replacement through the loader', async (scenario) => {
    const root = await mkdtemp(join(tmpdir(), 'token-monitor-reinstall-'))
    const pluginRoot = join(root, 'node_modules', 'token-monitor')
    const runtime = join(pluginRoot, 'runtime')
    const payload = 'export async function apply(ctx) { ctx.restoredRuntime = true }'
    const artifact = (path: string, content: string) => ({ root: 'host', path, size: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') })
    const previous = { schemaVersion: 1, version: '4.2.0', core: [artifact('old-core.mjs', 'old')], modules: [{ id: 'pet', files: [artifact('old-pet.mjs', 'old')] }] }
    const replacement = { schemaVersion: 1, version: '4.2.1', core: [artifact('manager.mjs', payload)], modules: [{ id: 'pet', files: [artifact('pet.mjs', 'pet')] }] }
    const cleanups: Array<() => unknown> = []
    const ctx = {
      restoredRuntime: false, logger: { warn: vi.fn() }, inject: vi.fn(),
      effect(factory: () => unknown) { const cleanup = factory(); if (typeof cleanup === 'function') cleanups.push(cleanup as () => unknown) },
    }
    try {
      await mkdir(join(runtime, 'host'), { recursive: true })
      await mkdir(join(root, '.dsh-damage-pulse'))
      await writeFile(join(runtime, 'manifest.json'), JSON.stringify(replacement))
      await writeFile(join(runtime, 'host', 'manager.mjs'), payload)
      if (scenario !== 'partial') await writeFile(join(runtime, 'host', 'pet.mjs'), 'pet')
      for (const path of ['old-core.mjs', 'old-pet.mjs']) await writeFile(join(runtime, 'host', path), 'old')
      const stateFile = join(root, '.dsh-damage-pulse', 'module-state.json')
      await writeFile(stateFile, JSON.stringify({
        schemaVersion: 1, revision: 3, version: previous.version,
        removed: { pet: { preserveData: true, pending: scenario === 'pending-module', erased: true } },
        restartRequired: false, manifest: previous,
        wholePlugin: { preserveData: true, pending: scenario === 'pending-core', erased: true },
      }))
      await bootModules(ctx as unknown as Context, pluginRoot, join(runtime, 'client'))
      const state = JSON.parse(await readFile(stateFile, 'utf8'))
      expect(ctx.restoredRuntime).toBe(scenario === 'complete')
      if (scenario === 'complete') {
        expect(state.wholePlugin).toBeUndefined()
        expect(state.removed).toEqual({})
        expect(state.version).toBe(replacement.version)
        expect(state.revision).toBe(4)
      } else {
        expect(state.wholePlugin.pending).toBe(false)
        expect(state.removed.pet.pending).toBe(false)
        expect(state.version).toBe(previous.version)
        expect(ctx.inject).toHaveBeenCalledOnce()
        if (scenario === 'partial') {
          expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringMatching(/PLUGIN_REINSTALL_INCOMPLETE.*remove.*desktop Plugins.*complete packaged.*restart/))
        } else {
          await expect(readFile(join(runtime, 'host', scenario === 'pending-core' ? 'old-core.mjs' : 'old-pet.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
          expect(ctx.logger.warn).not.toHaveBeenCalled()
        }
      }
      expect(await readFile(join(runtime, 'host', 'manager.mjs'), 'utf8')).toBe(payload)
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup()
      await rm(root, { recursive: true, force: true })
    }
  })

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
    const home = await mkdtemp(join(tmpdir(), 'token-monitor-boot-'))
    const pluginRoot = join(home, 'node_modules', 'token-monitor')
    try {
      await mkdir(pluginRoot, { recursive: true })
      // A source install never runs the packaging step, so runtime/ is absent.
      // The preflight must reject before it creates the profile state directory.
      const failure = await bootModules({} as unknown as Context, pluginRoot, pluginRoot).then(() => undefined, (error: Error) => error)
      // 1) 直接事实：点名缺失文件与插件无法启动。
      expect(failure?.message).toMatch(/runtime[\\/]manifest\.json/u)
      expect(failure?.message).toMatch(/payload is incomplete/u)
      expect(failure?.message).toMatch(/cannot start/u)
      // 2) 影响：说明这是载荷缺失，不是普通的加载失败；未构建源码只是常见成因，不是唯一成因。
      expect(failure?.message).toMatch(/source address/u)
      expect(failure?.message).toMatch(/packaging step/u)
      expect(failure?.message).toMatch(/most common cause/u)
      expect(failure?.message).toMatch(/never[\s]+built/u)
      expect(failure?.message).toMatch(/damaged or partly extracted/u)
      expect(failure?.message).not.toMatch(/only cause|the sole cause/iu)
      // 不得承诺自动修复或自动卸载。
      expect(failure?.message).not.toMatch(/automatically|automatic /iu)
      // 3) 恢复方向：正确 profile 的正式安装包，同版本重装需先卸载。
      expect(failure?.message).toMatch(/dsh plugin --profile/u)
      expect(failure?.message).toMatch(/uninstall it first/u)
      // 4) 无副作用：预检在创建 profile 状态目录之前失败。
      await expect(readFile(join(home, '.dsh-damage-pulse', 'module-state.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('passes a non-ENOENT payload check error through unchanged', async () => {
    const home = await mkdtemp(join(tmpdir(), 'token-monitor-boot-'))
    // 路径含空字符：access() 抛出的不是 ENOENT，而是原样的 ERR_INVALID_ARG_VALUE。
    // 预检必须把它原样抛出，不能改写成“源码安装缺载荷”的诊断。
    const pluginRoot = join(home, 'node_modules', 'token-monitor') + '\u0000broken'
    try {
      const failure = await bootModules({} as unknown as Context, pluginRoot, pluginRoot).then(() => undefined, (error: Error) => error)
      expect(failure?.message).not.toMatch(/payload is incomplete/u)
      expect(failure?.message).not.toMatch(/source address/u)
      expect((failure as NodeJS.ErrnoException)?.code).toBe('ERR_INVALID_ARG_VALUE')
      await expect(readFile(join(home, '.dsh-damage-pulse', 'module-state.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
