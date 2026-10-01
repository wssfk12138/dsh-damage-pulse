import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleReleaseManifest } from '@deepseek-ai/dsh-token-monitor-contract'
import { afterEach, expect, it } from 'vitest'
import { synchronizeClientEntry } from '../src/client-entry.ts'
import { apply } from '../src/runtime-host.ts'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-client-entry-')); dirs.push(dir)
  const roots = { host: join(dir, 'runtime/host'), client: join(dir, 'runtime/client'), assets: join(dir, 'runtime/assets') }
  for (const path of [...Object.values(roots), join(dir, 'lib')]) await mkdir(path, { recursive: true })
  const pkg = { name: 'dsh-damage-pulse', version: '4.2.1', exports: { './client': './lib/client.js' } }
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg))
  const bytes = Buffer.from('window.newVerifiedClient = true;')
  const manifest: ModuleReleaseManifest = { schemaVersion: 1, version: '4.2.3', core: [
    { root: 'client', path: 'client.js', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
  ], modules: [] }
  const entry = join(dir, 'lib/client.js')
  await writeFile(entry, 'old frontend')
  await writeFile(join(roots.client, 'client.js'), bytes)
  return { dir, roots, manifest, bytes, entry, pkg }
}

it.each(['4.2.1', '4.2.2'])('repairs the static entry of an installation whose module state reached %s', async version => {
  const f = await fixture()
  const state = { schemaVersion: 1, version, revision: 2, restartRequired: true, removed: { pet: { preserveData: true, pending: false } } }
  await writeFile(join(f.dir, 'state.json'), JSON.stringify(state))
  await synchronizeClientEntry(f.roots, f.manifest)
  expect(await readFile(f.entry)).toEqual(f.bytes)
  expect(JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8'))).toEqual(state)
  expect(JSON.parse(await readFile(join(f.dir, 'package.json'), 'utf8'))).toEqual(f.pkg)
  expect(await readdir(join(f.dir, 'lib'))).toEqual(['client.js'])
})

it('does not rewrite an already verified entry on subsequent boots', async () => {
  const f = await fixture()
  await writeFile(f.entry, f.bytes)
  const before = await stat(f.entry)
  await synchronizeClientEntry(f.roots, f.manifest)
  expect((await stat(f.entry)).mtimeMs).toBe(before.mtimeMs)
})

it('tracks another verified release on a later boot without changing package metadata', async () => {
  const f = await fixture()
  await synchronizeClientEntry(f.roots, f.manifest)
  const next = Buffer.from('window.nextVerifiedClient = true;')
  await writeFile(join(f.roots.client, 'client.js'), next)
  const manifest: ModuleReleaseManifest = { ...f.manifest, version: '4.2.4', core: [
    { root: 'client', path: 'client.js', size: next.length, sha256: createHash('sha256').update(next).digest('hex') },
  ] }
  await synchronizeClientEntry(f.roots, manifest)
  expect(await readFile(f.entry)).toEqual(next)
  expect(JSON.parse(await readFile(join(f.dir, 'package.json'), 'utf8'))).toEqual(f.pkg)
})

it('rejects corrupt runtime bytes without replacing the previous entry', async () => {
  const f = await fixture()
  await writeFile(join(f.roots.client, 'client.js'), 'corrupt')
  await expect(synchronizeClientEntry(f.roots, f.manifest)).rejects.toThrow('ARTIFACT_DIGEST_MISMATCH')
  expect(await readFile(f.entry, 'utf8')).toBe('old frontend')
  expect(await readdir(join(f.dir, 'lib'))).toEqual(['client.js'])
})

it('refuses a linked destination directory without touching its contents', async () => {
  const f = await fixture()
  const outside = await mkdtemp(join(tmpdir(), 'dsh-client-outside-')); dirs.push(outside)
  await writeFile(join(outside, 'client.js'), 'outside')
  await rm(join(f.dir, 'lib'), { recursive: true })
  await symlink(outside, join(f.dir, 'lib'), 'junction')
  await expect(synchronizeClientEntry(f.roots, f.manifest)).rejects.toThrow('ARTIFACT_LINK_REFUSED')
  expect(await readFile(join(outside, 'client.js'), 'utf8')).toBe('outside')
})

it('fails closed when the declared installed client entry is unsupported', async () => {
  const f = await fixture()
  await writeFile(join(f.dir, 'package.json'), JSON.stringify({ ...f.pkg, exports: { './client': '../elsewhere.js' } }))
  await expect(synchronizeClientEntry(f.roots, f.manifest)).rejects.toThrow('UNSUPPORTED_INSTALLED_CLIENT_ENTRY')
  expect(await readFile(f.entry, 'utf8')).toBe('old frontend')
})

it('does not change a source checkout or an entry already pointing at the runtime', async () => {
  const f = await fixture()
  await synchronizeClientEntry({ ...f.roots, client: join(f.dir, 'workspace/lib') }, f.manifest)
  await writeFile(join(f.dir, 'package.json'), JSON.stringify({ ...f.pkg, exports: { './client': './runtime/client/client.js' } }))
  await synchronizeClientEntry(f.roots, f.manifest)
  expect(await readFile(f.entry, 'utf8')).toBe('old frontend')
})

it('repairs before runtime services start and before restart status can be cleared', async () => {
  const f = await fixture()
  await expect(apply({} as Context, { ...f, stateFile: join(f.dir, 'state.json'), loadCore: async () => {
    expect(await readFile(f.entry)).toEqual(f.bytes)
    throw new Error('STOP_AFTER_VERIFIED_ENTRY')
  } })).rejects.toThrow('STOP_AFTER_VERIFIED_ENTRY')
})

it('preserves restart-required state and starts no services if the entry cannot be replaced', async () => {
  const f = await fixture()
  await rm(f.entry)
  await mkdir(f.entry)
  const stateFile = join(f.dir, 'state.json')
  const state = JSON.stringify({ schemaVersion: 1, revision: 1, version: '4.2.3', restartRequired: true })
  await writeFile(stateFile, state)
  let started = false
  await expect(apply({} as Context, { ...f, stateFile, loadCore: async () => {
    started = true; throw new Error('UNEXPECTED_CORE_START')
  } })).rejects.toThrow()
  expect(started).toBe(false)
  expect(await readFile(stateFile, 'utf8')).toBe(state)
  expect((await stat(f.entry)).isDirectory()).toBe(true)
  expect(await readdir(join(f.dir, 'lib'))).toEqual(['client.js'])
})
