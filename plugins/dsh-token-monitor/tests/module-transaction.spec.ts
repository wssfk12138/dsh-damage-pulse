import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { replaceModuleArtifacts, recoverModuleTransaction } from '../src/module-transaction.ts'
import type { ModuleArtifact } from '@deepseek-ai/dsh-token-monitor-contract'
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-txn-')); dirs.push(dir)
  const roots = { host: join(dir, 'host'), client: join(dir, 'client'), assets: join(dir, 'assets') }
  await Promise.all(Object.values(roots).map(p => mkdir(p)))
  const state = join(dir, 'state.json'), previous = { schemaVersion: 1, revision: 0 }
  await writeFile(state, JSON.stringify(previous))
  const file: ModuleArtifact = { root: 'host', path: 'module.js', size: 3, sha256: createHash('sha256').update('new').digest('hex') }
  await writeFile(join(roots.host, file.path), 'old')
  return { dir, roots, state, previous, file }
}
it('rejects bad bytes before replacement and leaves no local recovery package', async () => {
  const f = await fixture()
  await expect(replaceModuleArtifacts(f.state, f.roots, [f.file], async () => Buffer.from('bad'), async save => save({ revision: 1 }))).rejects.toThrow('ARTIFACT_DIGEST_MISMATCH')
  expect(await readFile(join(f.roots.host, f.file.path), 'utf8')).toBe('old')
  expect((await readdir(f.dir)).sort()).toEqual(['assets', 'client', 'host', 'state.json'])
})
it('rolls back replaced and obsolete files and removes new files if activation fails', async () => {
  const f = await fixture(), added = { ...f.file, path: 'added.js' }, obsolete = { ...f.file, path: 'obsolete.js' }
  await writeFile(join(f.roots.host, obsolete.path), 'legacy')
  await expect(replaceModuleArtifacts(f.state, f.roots, [f.file, added], async () => Buffer.from('new'), async () => { throw new Error('activation') }, [obsolete])).rejects.toThrow('activation')
  expect(await readFile(join(f.roots.host, f.file.path), 'utf8')).toBe('old')
  expect(await readFile(join(f.roots.host, obsolete.path), 'utf8')).toBe('legacy')
  await expect(readFile(join(f.roots.host, added.path))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(JSON.parse(await readFile(f.state, 'utf8'))).toEqual(f.previous)
})
it('commits exact state and payload and cleans temporary files', async () => {
  const f = await fixture(), next = { schemaVersion: 1, revision: 1 }
  await replaceModuleArtifacts(f.state, f.roots, [f.file], async () => Buffer.from('new'), save => save(next))
  expect(await readFile(join(f.roots.host, f.file.path), 'utf8')).toBe('new')
  expect(JSON.parse(await readFile(f.state, 'utf8'))).toEqual(next)
  expect(await readdir(f.roots.host)).toEqual(['module.js'])
  expect((await readdir(f.dir)).sort()).toEqual(['assets', 'client', 'host', 'state.json'])
})
it('retains committed files when a callback fails after durable commit', async () => {
  const f = await fixture(), next = { schemaVersion: 1, revision: 1 }
  await expect(replaceModuleArtifacts(f.state, f.roots, [f.file], async () => Buffer.from('new'), async save => {
    await save(next)
    throw new Error('after commit')
  })).rejects.toThrow('MODULE_COMMITTED_RESTART_REQUIRED')
  await recoverModuleTransaction(f.state, f.roots)
  expect(JSON.parse(await readFile(f.state, 'utf8'))).toEqual(next)
  expect(await readFile(join(f.roots.host, f.file.path), 'utf8')).toBe('new')
})
it.each(['preparing', 'replacing', 'committing'] as const)('recovers interruption at %s', async phase => {
  const f = await fixture(), id = randomUUID(), staging = join(f.dir, `module-transaction-${id}`)
  await mkdir(staging)
  await writeFile(join(staging, '0.old'), 'old')
  await writeFile(join(staging, '0.new'), 'new')
  const next = { schemaVersion: 1, revision: 1 }
  const journal = { schemaVersion: 1, id, previousState: JSON.stringify(f.previous), nextState: JSON.stringify(next), phase, entries: [{ file: f.file, existed: true, remove: false }] }
  await writeFile(`${f.state}.transaction.json`, JSON.stringify(journal))
  if (phase !== 'preparing') await writeFile(join(f.roots.host, f.file.path), 'new')
  if (phase === 'committing') await writeFile(f.state, JSON.stringify(next))
  await recoverModuleTransaction(f.state, f.roots)
  expect(await readFile(join(f.roots.host, f.file.path), 'utf8')).toBe(phase === 'committing' ? 'new' : 'old')
  expect((await readdir(f.dir)).sort()).toEqual(['assets', 'client', 'host', 'state.json'])
})
it('refuses recovery with a missing required backup', async () => {
  const f = await fixture(), id = randomUUID()
  await mkdir(join(f.dir, `module-transaction-${id}`))
  await writeFile(`${f.state}.transaction.json`, JSON.stringify({ schemaVersion: 1, id, phase: 'replacing', previousState: JSON.stringify(f.previous), entries: [{ file: f.file, existed: true, remove: false }] }))
  await expect(recoverModuleTransaction(f.state, f.roots)).rejects.toThrow('MODULE_ROLLBACK_PENDING')
})
