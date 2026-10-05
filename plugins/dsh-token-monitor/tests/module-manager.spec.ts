import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModuleArtifact, ModuleReleaseManifest } from '@deepseek-ai/dsh-token-monitor-contract'
import { ModuleManager } from '../src/module-manager.ts'
import { validateManifest, validReleaseVersion } from '../src/module-files.ts'

const directories: string[] = []
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-module-test-')); directories.push(dir)
  const roots = { host: join(dir, 'host'), client: join(dir, 'client'), assets: join(dir, 'assets') }
  await Promise.all(Object.values(roots).map(root => mkdir(root)))
  const file = (path: string): ModuleArtifact => ({ root: 'host', path, size: 7, sha256: createHash('sha256').update('payload').digest('hex') })
  const manifest: ModuleReleaseManifest = { schemaVersion: 1, version: '4.0.3', core: [file('core.js')], modules: ['pet', 'overview', 'notify', 'billing', 'wechat'].map(id => ({ id, files: [file(id + '.js')] })) }
  for (const artifact of [...manifest.core, ...manifest.modules.flatMap(m => m.files)]) await writeFile(join(roots[artifact.root], artifact.path), 'payload')
  const lifecycle = { stop: vi.fn(async (_id: string) => {}), start: vi.fn(async (_id: string) => {}), eraseData: vi.fn(async (_id: string) => {}), stopCore: vi.fn(async () => {}), startCore: vi.fn(async () => {}) }
  const state = join(dir, 'state.json')
  const manager = await ModuleManager.open(manifest, state, roots, lifecycle)
  return { dir, roots, manifest, lifecycle, manager, state }
}

describe('physical module lifecycle', () => {
  it('removes selected bytes, preserves data by default request, leaves other modules and core intact', async () => {
    const f = await fixture()
    const result = await f.manager.uninstall({ ids: ['billing'], preserveData: true, expectedRevision: 0 })
    expect(result.modules.find(m => m.id === 'billing')).toMatchObject({ status: 'removed', autoInstallBlocked: true })
    await expect(readFile(join(f.roots.host, 'billing.js'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(f.roots.host, 'core.js'), 'utf8')).toBe('payload')
    expect(f.manager.isInstalled('overview')).toBe(true)
    expect(f.lifecycle.eraseData).not.toHaveBeenCalled()
    expect(f.lifecycle.stopCore).not.toHaveBeenCalled()
  })
  it('persists the block before teardown and erases only the selected module data', async () => {
    const f = await fixture()
    f.lifecycle.stop.mockImplementation(async () => { expect(JSON.parse(await readFile(f.state, 'utf8')).removed.notify.pending).toBe(true) })
    await f.manager.uninstall({ ids: ['notify'], preserveData: false, expectedRevision: 0 })
    expect(f.lifecycle.eraseData.mock.calls).toEqual([['notify', { configuration: true, history: true }]])
  })
  it('retries deletion after restart and removes accidentally recopied payloads', async () => {
    const f = await fixture()
    f.lifecycle.stop.mockRejectedValueOnce(new Error('busy'))
    expect((await f.manager.uninstall({ ids: ['pet'], preserveData: true, expectedRevision: 0 })).modules[0]?.status).toBe('pending-delete')
    const reopened = await ModuleManager.open(f.manifest, f.state, f.roots, f.lifecycle)
    expect(reopened.snapshot().modules[0]?.status).toBe('removed')
    await writeFile(join(f.roots.host, 'pet.js'), 'payload')
    await ModuleManager.open(f.manifest, f.state, f.roots, f.lifecycle)
    await expect(readFile(join(f.roots.host, 'pet.js'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('keeps a tombstone when a package-manager upgrade replaces the payload', async () => {
    const f = await fixture()
    await f.manager.uninstall({ ids: ['pet'], preserveData: true, expectedRevision: 0 })
    const next = structuredClone(f.manifest); next.version = '4.0.4'
    await writeFile(join(f.roots.host, 'pet.js'), 'payload')
    const upgraded = await ModuleManager.open(next, f.state, f.roots, f.lifecycle)
    expect(upgraded.snapshot()).toMatchObject({ version: '4.0.4', revision: 2 })
    expect(upgraded.snapshot().modules.find(m => m.id === 'pet')).toMatchObject({ status: 'removed', autoInstallBlocked: true })
    await expect(readFile(join(f.roots.host, 'pet.js'))).rejects.toMatchObject({ code: 'ENOENT' })
    const saved = JSON.parse(await readFile(f.state, 'utf8'))
    expect(saved.manifest.version).toBe('4.0.4')
    expect(saved.removed.pet).toBeDefined()
  })
  it('does not erase newly collected history again when boot cleanup removes recopied files', async () => {
    const f = await fixture()
    await f.manager.uninstall({ ids: ['overview'], preserveData: false, expectedRevision: 0 })
    await writeFile(join(f.roots.host, 'overview.js'), 'payload')
    await ModuleManager.open(f.manifest, f.state, f.roots, f.lifecycle)
    expect(f.lifecycle.eraseData).toHaveBeenCalledOnce()
    await expect(readFile(join(f.roots.host, 'overview.js'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('refuses stale submissions without deleting more files', async () => {
    const f = await fixture()
    await f.manager.uninstall({ ids: ['pet'], preserveData: true, expectedRevision: 0 })
    await expect(f.manager.uninstall({ ids: ['billing'], preserveData: false, expectedRevision: 0 })).rejects.toMatchObject({ code: 'MODULE_STATE_CONFLICT' })
    expect(f.manager.isInstalled('billing')).toBe(true)
  })
  it('fails closed on corrupt state and damaged artifacts', async () => {
    const f = await fixture()
    await writeFile(join(f.roots.host, 'pet.js'), 'damaged')
    const reopened = await ModuleManager.open(f.manifest, f.state, f.roots, f.lifecycle)
    expect(reopened.snapshot().modules[0]?.status).toBe('unavailable')
    await writeFile(f.state, '{}')
    await expect(ModuleManager.open(f.manifest, f.state, f.roots, f.lifecycle)).rejects.toThrow('INVALID_MODULE_STATE')
  })
  it('updates installed and genuinely new modules without reinstalling tombstones', async () => {
    const f = await fixture()
    await f.manager.uninstall({ ids: ['pet'], preserveData: true, expectedRevision: 0 })
    const next = structuredClone(f.manifest); next.version = '4.0.4'
    next.modules.push({ id: 'future-module', files: [{ ...next.core[0]!, path: 'future.js' }] })
    let paths: string[] = []
    await f.manager.install(next, 1, undefined, async (files, commit) => {
      expect(f.lifecycle.stopCore).toHaveBeenCalledOnce()
      expect(f.lifecycle.stop).toHaveBeenCalledWith('billing')
      paths = files.map(f => f.path)
      for (const file of files) await writeFile(join(f.roots[file.root], file.path), 'payload')
      await commit()
    })
    expect(paths).toContain('core.js'); expect(paths).toContain('future.js'); expect(paths).not.toContain('pet.js')
    expect(f.manager.snapshot()).toMatchObject({ version: '4.0.4', restartRequired: true })
    await expect(f.manager.uninstall({ ids: ['billing'], preserveData: true, expectedRevision: 2 })).rejects.toMatchObject({ code: 'PLUGIN_RESTART_REQUIRED' })
    expect(JSON.parse(await readFile(f.state, 'utf8')).manifest.version).toBe('4.0.4')
  })
  it('refuses a second manager whose disk state changed after it opened', async () => {
    const f = await fixture()
    const second = await ModuleManager.open(f.manifest, f.state, f.roots, f.lifecycle)
    await f.manager.uninstall({ ids: ['pet'], preserveData: true, expectedRevision: 0 })
    await expect(second.uninstall({ ids: ['billing'], preserveData: true, expectedRevision: 0 })).rejects.toMatchObject({ code: 'MODULE_STATE_CONFLICT' })
    expect(await readFile(join(f.roots.host, 'billing.js'), 'utf8')).toBe('payload')
  })
  it('keeps restoration blocked when activation fails and permits retry', async () => {
    const f = await fixture()
    await f.manager.uninstall({ ids: ['pet'], preserveData: true, expectedRevision: 0 })
    f.lifecycle.start.mockRejectedValueOnce(new Error('activation failed'))
    const replace = async (files: ModuleArtifact[], commit: () => Promise<void>) => {
      for (const file of files) await writeFile(join(f.roots[file.root], file.path), 'payload')
      try { await commit() } catch (error) {
        for (const file of files) await rm(join(f.roots[file.root], file.path))
        throw error
      }
    }
    await expect(f.manager.install(f.manifest, 1, 'pet', replace)).rejects.toMatchObject({ code: 'MODULE_ACTIVATION_FAILED' })
    expect(f.manager.snapshot().modules[0]).toMatchObject({ status: 'removed', autoInstallBlocked: true })
    await expect(readFile(join(f.roots.host, 'pet.js'))).rejects.toMatchObject({ code: 'ENOENT' })
    await f.manager.install(f.manifest, 1, 'pet', replace)
    expect(f.manager.isInstalled('pet')).toBe(true)
  })
  it('resumes the previous runtime if an upgrade fails before commit', async () => {
    const f = await fixture()
    await expect(f.manager.install({ ...f.manifest, version: '4.0.4' }, 0, undefined, async () => { throw new Error('download failed') })).rejects.toThrow('download failed')
    expect(f.lifecycle.startCore).toHaveBeenCalledOnce()
    expect(f.lifecycle.start).toHaveBeenCalledTimes(5)
    expect(f.manager.snapshot()).toMatchObject({ version: '4.0.3', restartRequired: false, revision: 0 })
  })
  it('refuses downgrades and altered same-version releases', async () => {
    const f = await fixture()
    const replace = vi.fn()
    await expect(f.manager.install({ ...f.manifest, version: '4.0.2' }, 0, 'pet', replace)).rejects.toMatchObject({ code: 'MODULE_DOWNGRADE_REFUSED' })
    const changed = structuredClone(f.manifest); changed.core[0]!.size++
    await expect(f.manager.install(changed, 0, 'pet', replace)).rejects.toMatchObject({ code: 'RELEASE_CONTENT_CHANGED' })
    expect(replace).not.toHaveBeenCalled()
  })
  it('whole uninstall deletes core and every module and stops the collector', async () => {
    const f = await fixture()
    const snapshot = await f.manager.uninstall({ ids: [], wholePlugin: true, preserveData: false, expectedRevision: 0 })
    expect(snapshot.pluginRemoved).toBe(true)
    expect(snapshot.modules.every(m => m.status === 'removed')).toBe(true)
    expect(f.lifecycle.stopCore).toHaveBeenCalledOnce()
    expect(f.lifecycle.eraseData).toHaveBeenCalledWith('plugin', { configuration: true, history: true })
    await expect(readFile(join(f.roots.host, 'core.js'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('restores a complete package after whole removal without repeating data erasure', async () => {
    const f = await fixture()
    await f.manager.uninstall({ ids: [], wholePlugin: true, preserveData: false, expectedRevision: 0 })
    const calls = f.lifecycle.eraseData.mock.calls.length
    expect((await ModuleManager.open(f.manifest, f.state, f.roots, f.lifecycle, true)).snapshot().pluginRemoved).toBe(true)
    for (const file of [...f.manifest.core, ...f.manifest.modules.flatMap(m => m.files)]) await writeFile(join(f.roots[file.root], file.path), 'payload')
    const restored = await ModuleManager.open(f.manifest, f.state, f.roots, f.lifecycle, true)
    expect(restored.snapshot()).toMatchObject({ pluginRemoved: false, revision: 2 })
    expect(restored.snapshot().modules.every(m => m.status === 'installed')).toBe(true)
    expect(f.lifecycle.eraseData.mock.calls.length).toBe(calls)
    expect(JSON.parse(await readFile(f.state, 'utf8')).wholePlugin).toBeUndefined()
  })
  it('preserves partial reinstall bytes and reports the incomplete package', async () => {
    const f = await fixture()
    await f.manager.uninstall({ ids: [], wholePlugin: true, preserveData: true, expectedRevision: 0 })
    await writeFile(join(f.roots.host, 'core.js'), 'payload')
    const reopened = await ModuleManager.open(f.manifest, f.state, f.roots, f.lifecycle, true)
    expect(reopened.snapshot()).toMatchObject({ pluginRemoved: true, cleanupErrors: ['PLUGIN_REINSTALL_INCOMPLETE'] })
    expect(await readFile(join(f.roots.host, 'core.js'), 'utf8')).toBe('payload')
    expect(f.lifecycle.eraseData).not.toHaveBeenCalled()
  })
  it('refuses corrupt reinstall bytes and does not revive a removed plugin implicitly', async () => {
    const f = await fixture()
    await f.manager.uninstall({ ids: [], wholePlugin: true, preserveData: true, expectedRevision: 0 })
    for (const file of [...f.manifest.core, ...f.manifest.modules.flatMap(m => m.files)]) await writeFile(join(f.roots[file.root], file.path), 'payload')
    expect((await ModuleManager.open(f.manifest, f.state, f.roots, f.lifecycle)).snapshot().pluginRemoved).toBe(true)
    await writeFile(join(f.roots.host, 'pet.js'), 'damaged')
    expect((await ModuleManager.open(f.manifest, f.state, f.roots, f.lifecycle, true)).snapshot().pluginRemoved).toBe(true)
    expect(await readFile(join(f.roots.host, 'pet.js'), 'utf8')).toBe('damaged')
  })
  it('accepts the installed package manifest after a completed whole removal', async () => {
    const f = await fixture()
    await f.manager.uninstall({ ids: [], wholePlugin: true, preserveData: true, expectedRevision: 0 })
    const next = structuredClone(f.manifest)
    next.core[0]!.sha256 = createHash('sha256').update('changed').digest('hex')
    for (const file of [...next.core, ...next.modules.flatMap(m => m.files)]) await writeFile(join(f.roots[file.root], file.path), file.path === 'core.js' ? 'changed' : 'payload')
    expect((await ModuleManager.open(next, f.state, f.roots, f.lifecycle, true)).snapshot().pluginRemoved).toBe(false)
    expect(JSON.parse(await readFile(f.state, 'utf8')).manifest).toEqual(next)
  })
  it('validates semver, reserved ids, traversal, duplicate ownership and unsafe paths', async () => {
    const f = await fixture()
    expect(validReleaseVersion('4x0x3')).toBe(false)
    for (const path of ['../outside.js', '/absolute', 'a/../b', 'CON.js', 'a:b', 'a./x']) {
      const value = structuredClone(f.manifest); value.core[0]!.path = path
      expect(() => validateManifest(value)).toThrow()
    }
    const duplicate = structuredClone(f.manifest); duplicate.modules[0]!.files = duplicate.core
    expect(() => validateManifest(duplicate)).toThrow('DUPLICATE_MODULE_ARTIFACT')
    const reserved = structuredClone(f.manifest); reserved.modules[0]!.id = 'plugin'
    expect(() => validateManifest(reserved)).toThrow('INVALID_MODULE_ID')
  })
})
