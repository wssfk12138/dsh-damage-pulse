/** Interrupted replacements are recovered before any runtime payload is loaded. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModuleArtifact } from '@deepseek-ai/dsh-token-monitor-contract'
import { atomicJson, confinedPath, validateManifest, type ArtifactRoots } from './module-files.ts'

interface Entry { file: ModuleArtifact; existed: boolean; remove: boolean }
interface Journal {
  schemaVersion: 1; id: string; previousState: string; nextState?: string; entries: Entry[]
  phase: 'preparing' | 'replacing' | 'committing' | 'rolling-back' | 'rolled-back'
}
export type PersistModuleState = (state: unknown) => Promise<void>
export class ModuleRollbackError extends Error {
  constructor() { super('MODULE_ROLLBACK_PENDING') }
}
/** The new state is durable; callers must not restore an older in-memory release. */
export class ModuleCommittedError extends Error {
  constructor() { super('MODULE_COMMITTED_RESTART_REQUIRED') }
}
async function missing(file: string): Promise<boolean> {
  try { if (!(await lstat(file)).isFile()) throw new Error('ARTIFACT_NOT_FILE'); return false }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error }
}
async function unlinkIfPresent(file: string): Promise<void> {
  try { await unlink(file) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
async function directoryFor(stateFile: string, id: string): Promise<string> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error('INVALID_TRANSACTION_ID')
  return confinedPath(dirname(stateFile), `module-transaction-${id}`)
}
async function temporary(roots: ArtifactRoots, entry: Entry, id: string): Promise<string> {
  return confinedPath(roots[entry.file.root], `${entry.file.path}.${id}.tmp`)
}
async function clean(stateFile: string, roots: ArtifactRoots, journal: Journal): Promise<void> {
  const directory = await directoryFor(stateFile, journal.id)
  for (let i = 0; i < journal.entries.length; i++) {
    await unlinkIfPresent(await confinedPath(directory, `${i}.old`))
    await unlinkIfPresent(await confinedPath(directory, `${i}.new`))
    await unlinkIfPresent(await temporary(roots, journal.entries[i]!, journal.id))
  }
  try { await rmdir(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await unlinkIfPresent(`${stateFile}.transaction.json`)
}
async function replaceFile(source: string, target: string, temp: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await unlinkIfPresent(temp)
  await copyFile(source, temp, constants.COPYFILE_EXCL)
  await rename(temp, target)
}
async function rollback(stateFile: string, roots: ArtifactRoots, journal: Journal): Promise<void> {
  const directory = await directoryFor(stateFile, journal.id)
  journal.phase = 'rolling-back'
  await atomicJson(`${stateFile}.transaction.json`, journal)
  for (let i = 0; i < journal.entries.length; i++) {
    const entry = journal.entries[i]!, target = await confinedPath(roots[entry.file.root], entry.file.path)
    if (entry.existed) {
      const backup = await confinedPath(directory, `${i}.old`)
      if (await missing(backup)) throw new ModuleRollbackError()
      await replaceFile(backup, target, await temporary(roots, entry, journal.id))
    } else await unlinkIfPresent(target)
  }
  await atomicJson(stateFile, JSON.parse(journal.previousState))
  journal.phase = 'rolled-back'
  await atomicJson(`${stateFile}.transaction.json`, journal)
  await clean(stateFile, roots, journal)
}
async function readJournal(stateFile: string): Promise<Journal | undefined> {
  const path = `${stateFile}.transaction.json`
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('INVALID_TRANSACTION_JOURNAL')
    const journal: Journal = JSON.parse(await readFile(path, 'utf8'))
    if (!journal || journal.schemaVersion !== 1 || typeof journal.previousState !== 'string'
      || !['preparing', 'replacing', 'committing', 'rolling-back', 'rolled-back'].includes(journal.phase)
      || !Array.isArray(journal.entries) || !journal.entries.length
      || journal.entries.some(e => !e || typeof e.existed !== 'boolean' || typeof e.remove !== 'boolean')) throw new Error('INVALID_TRANSACTION_JOURNAL')
    validateManifest({ schemaVersion: 1, version: '0.0.0', core: journal.entries.map(e => e.file), modules: [] })
    await directoryFor(stateFile, journal.id)
    const previous = JSON.parse(journal.previousState)
    if (previous?.schemaVersion !== 1 || !Number.isSafeInteger(previous.revision)) throw new Error('INVALID_TRANSACTION_STATE')
    if (journal.phase === 'committing' && typeof journal.nextState !== 'string') throw new Error('INVALID_TRANSACTION_STATE')
    return journal
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
}
/** Caller holds the writer lock; recovery never starts a partially replaced release. */
export async function recoverModuleTransaction(stateFile: string, roots: ArtifactRoots): Promise<void> {
  const journal = await readJournal(stateFile)
  if (!journal) return
  const current = JSON.stringify(JSON.parse(await readFile(stateFile, 'utf8')))
  if (journal.phase === 'committing' && current === journal.nextState) { await clean(stateFile, roots, journal); return }
  if (current !== JSON.stringify(JSON.parse(journal.previousState))) throw new Error('TRANSACTION_STATE_CONFLICT')
  if (journal.phase === 'preparing' || journal.phase === 'rolled-back') await clean(stateFile, roots, journal)
  else await rollback(stateFile, roots, journal)
}
/** Replace validated artifacts under the manager writer lock, retaining backups only until resolved. */
export async function replaceModuleArtifacts(
  stateFile: string, roots: ArtifactRoots, files: ModuleArtifact[],
  download: (file: ModuleArtifact) => Promise<Uint8Array>, commit: (persist: PersistModuleState) => Promise<void>,
  obsolete: ModuleArtifact[] = [],
): Promise<void> {
  if (await readJournal(stateFile)) throw new Error('MODULE_RECOVERY_REQUIRED')
  validateManifest({ schemaVersion: 1, version: '0.0.0', core: [...files, ...obsolete], modules: [] })
  const journal: Journal = { schemaVersion: 1, id: randomUUID(), previousState: await readFile(stateFile, 'utf8'), entries: [], phase: 'preparing' }
  for (const file of [...files, ...obsolete]) journal.entries.push({ file, existed: !await missing(await confinedPath(roots[file.root], file.path)), remove: obsolete.includes(file) })
  await atomicJson(`${stateFile}.transaction.json`, journal)
  const directory = await directoryFor(stateFile, journal.id)
  let committed = false
  try {
    await mkdir(directory, { mode: 0o700 })
    for (let i = 0; i < journal.entries.length; i++) {
      const entry = journal.entries[i]!, file = entry.file
      if (entry.existed) await copyFile(await confinedPath(roots[file.root], file.path), join(directory, `${i}.old`), constants.COPYFILE_EXCL)
      if (entry.remove) continue
      const bytes = await download(file)
      if (bytes.byteLength !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('ARTIFACT_DIGEST_MISMATCH')
      await writeFile(join(directory, `${i}.new`), bytes, { flag: 'wx', mode: 0o600 })
    }
    journal.phase = 'replacing'
    await atomicJson(`${stateFile}.transaction.json`, journal)
    for (let i = 0; i < journal.entries.length; i++) {
      const entry = journal.entries[i]!, target = await confinedPath(roots[entry.file.root], entry.file.path)
      if (entry.remove) await unlinkIfPresent(target)
      else await replaceFile(join(directory, `${i}.new`), target, await temporary(roots, entry, journal.id))
    }
    await commit(async state => {
      journal.phase = 'committing'; journal.nextState = JSON.stringify(state)
      await atomicJson(`${stateFile}.transaction.json`, journal)
      await atomicJson(stateFile, state)
      committed = true
    })
    if (!committed) throw new Error('MODULE_STATE_NOT_COMMITTED')
  } catch (error) {
    if (committed) throw new ModuleCommittedError()
    try {
      if (journal.phase === 'preparing') await clean(stateFile, roots, journal)
      else await rollback(stateFile, roots, journal)
    } catch { throw new ModuleRollbackError() }
    throw error
  }
  try { await clean(stateFile, roots, journal) }
  catch (error) { console.warn('[token-monitor] Committed cleanup deferred:', (error as NodeJS.ErrnoException).code ?? 'CLEANUP_PENDING') }
}
