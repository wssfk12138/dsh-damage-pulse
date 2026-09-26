import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import type { ModuleArtifact, ModuleReleaseManifest, ModuleSnapshot, ModuleUninstallRequest } from '@deepseek-ai/dsh-token-monitor-contract'
import { atomicJson, compareReleaseVersions, removeArtifact, validModuleId, validReleaseVersion, validateManifest, verifyArtifact, type ArtifactRoots } from './module-files.ts'
import { ModuleCommittedError, ModuleRollbackError, recoverModuleTransaction, type PersistModuleState } from './module-transaction.ts'

interface Removal { preserveData: boolean; preserveConfig?: boolean; preserveHistory?: boolean; pending: boolean; erased?: boolean }
function validRemoval(record: Removal): boolean {
  return !!record && typeof record.pending === 'boolean' && typeof record.preserveData === 'boolean'
    && [record.preserveConfig, record.preserveHistory, record.erased].every(value => value === undefined || typeof value === 'boolean')
}
interface InstalledState {
  schemaVersion: 1
  revision: number
  version: string
  removed: Record<string, Removal>
  wholePlugin?: Removal
  restartRequired: boolean
  manifest?: ModuleReleaseManifest
}
export interface ModuleLifecycle {
  /** Resolves only after all module requests, timers and registrations have stopped. */
  stop(id: string): Promise<void>
  start(id: string): Promise<void>
  /** Remove only this plugin's owned configuration/history, never host credentials. */
  eraseData(id: string, selection?: { configuration: boolean; history: boolean }): Promise<void>
  stopCore(): Promise<void>
  startCore(): Promise<void>
}
export class ModuleOperationError extends Error {
  constructor(readonly code: string, readonly httpStatus = 409) { super(code) }
}
/** One authoritative state file and one operation lock govern every destructive action. */
export class ModuleManager {
  private busy = false
  private unavailable = new Set<string>()
  private cleanupErrors = new Map<string, string>()
  private constructor(
    private manifest: ModuleReleaseManifest,
    private state: InstalledState,
    private readonly stateFile: string,
    readonly roots: ArtifactRoots,
    private readonly lifecycle: ModuleLifecycle,
  ) {}

  static async open(manifest: unknown, stateFile: string, roots: ArtifactRoots, lifecycle: ModuleLifecycle): Promise<ModuleManager> {
    await mkdir(dirname(stateFile), { recursive: true })
    return withFileLock(stateFile, () => this.openLocked(manifest, stateFile, roots, lifecycle))
  }

  private static async openLocked(manifest: unknown, stateFile: string, roots: ArtifactRoots, lifecycle: ModuleLifecycle): Promise<ModuleManager> {
    await recoverModuleTransaction(stateFile, roots)
    const release = validateManifest(manifest)
    let state: InstalledState
    try {
      state = JSON.parse(await readFile(stateFile, 'utf8'))
      if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0
        || !validReleaseVersion(state.version) || compareReleaseVersions(state.version, release.version) > 0
        || !state.removed || typeof state.removed !== 'object' || Array.isArray(state.removed)
        || typeof state.restartRequired !== 'boolean') throw new Error('INVALID_MODULE_STATE')
      for (const [id, record] of Object.entries(state.removed)) {
        if (!validModuleId(id) || !validRemoval(record)) throw new Error('INVALID_MODULE_STATE')
      }
      if (state.wholePlugin && !validRemoval(state.wholePlugin)) throw new Error('INVALID_MODULE_STATE')
      if (state.manifest) {
        const previous = validateManifest(state.manifest)
        if (previous.version !== state.version || state.version === release.version && !sameManifest(previous, release)) throw new Error('RELEASE_CONTENT_CHANGED')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      state = { schemaVersion: 1, revision: 0, version: release.version, removed: {}, restartRequired: false, manifest: release }
      await atomicJson(stateFile, state)
    }
    if (state.version !== release.version) {
      // Package-manager upgrade has already put the new payload on disk.
      // Preserve tombstones before cleanup removes recopied module files.
      state.version = release.version
      state.manifest = release
      state.restartRequired = false
      state.revision++
      await atomicJson(stateFile, state)
    }
    const manager = new ModuleManager(release, state, stateFile, roots, lifecycle)
    // A copied update must not bring an explicitly removed payload back to disk.
    if (state.wholePlugin) await lifecycle.stopCore()
    for (const id of Object.keys(state.removed)) await manager.finishRemoval(id)
    if (state.wholePlugin) await manager.finishRemoval('plugin')
    for (const module of release.modules) {
      if (state.removed[module.id] || state.wholePlugin) continue
      try { for (const file of module.files) await verifyArtifact(roots, file) }
      catch { manager.unavailable.add(module.id) }
    }
    if (!state.wholePlugin) for (const file of release.core) await verifyArtifact(roots, file)
    if (state.restartRequired && !state.wholePlugin && !manager.unavailable.size) {
      state.restartRequired = false
      state.revision++
      await manager.save()
    }
    return manager
  }

  isInstalled(id: string): boolean {
    return !this.state.wholePlugin && !this.state.removed[id] && !this.unavailable.has(id) && this.manifest.modules.some(m => m.id === id)
  }

  /** Includes tombstones for modules absent from an intermediate release. */
  autoInstallBlocked(id: string): boolean { return !!this.state.wholePlugin || !!this.state.removed[id] }

  snapshot(): ModuleSnapshot {
    return {
      schemaVersion: 1, revision: this.state.revision, version: this.state.version,
      pluginRemoved: !!this.state.wholePlugin, restartRequired: this.state.restartRequired,
      ...(this.state.wholePlugin?.pending ? { cleanupPending: true } : {}),
      ...(this.cleanupErrors.size ? { cleanupErrors: [...this.cleanupErrors.values()] } : {}),
      modules: this.manifest.modules.map(({ id }) => {
        const removal = this.state.wholePlugin ?? this.state.removed[id]
        return { id, autoInstallBlocked: !!removal, status: removal ? removal.pending ? 'pending-delete' : 'removed' : this.unavailable.has(id) ? 'unavailable' : 'installed' }
      }),
    }
  }

  async uninstall(request: ModuleUninstallRequest): Promise<ModuleSnapshot> {
    return this.exclusive(request.expectedRevision, async () => {
      if (this.state.wholePlugin && !request.wholePlugin) throw new ModuleOperationError('PLUGIN_REMOVED')
      if (this.state.restartRequired) throw new ModuleOperationError('PLUGIN_RESTART_REQUIRED')
      if (typeof request.preserveData !== 'boolean' || [request.preserveConfig, request.preserveHistory, request.wholePlugin].some(value => value !== undefined && typeof value !== 'boolean') || !Array.isArray(request.ids) || request.ids.length > 64
        || request.ids.some(id => !this.manifest.modules.some(m => m.id === id)) || (!request.wholePlugin && !request.ids.length)) throw new ModuleOperationError('INVALID_MODULE_REQUEST', 400)
      const ids = request.wholePlugin ? this.manifest.modules.map(m => m.id) : [...new Set(request.ids)]
      if (!request.wholePlugin && ids.some(id => this.state.removed[id] && !this.state.removed[id]!.pending)) throw new ModuleOperationError('MODULE_ALREADY_REMOVED')
      // Persist tombstones BEFORE teardown so a crash can never enable the module again.
      const previous = structuredClone(this.state)
      const record = { preserveData: request.preserveData, preserveConfig: request.preserveConfig ?? request.preserveData, preserveHistory: request.preserveHistory ?? request.preserveData, pending: true }
      for (const id of ids) this.state.removed[id] ??= { ...record }
      if (request.wholePlugin) this.state.wholePlugin ??= { ...record }
      this.state.revision++
      try { await this.save() } catch (error) { this.state = previous; throw error }
      if (request.wholePlugin) {
        try { await this.lifecycle.stopCore() }
        catch { this.cleanupErrors.set('plugin', 'PLUGIN_STOP_FAILED'); return this.snapshot() }
      }
      for (const id of ids) await this.finishRemoval(id)
      if (request.wholePlugin) await this.finishRemoval('plugin')
      return this.snapshot()
    })
  }

  private async finishRemoval(id: string): Promise<void> {
    const record = id === 'plugin' ? this.state.wholePlugin : this.state.removed[id]
    if (!record) return
    const files = id === 'plugin' ? this.manifest.core : this.manifest.modules.find(m => m.id === id)?.files ?? []
    record.pending = true
    this.cleanupErrors.delete(id)
    try {
      if (id === 'plugin' && Object.values(this.state.removed).some(item => item.pending)) return
      // Whole removal stops capture before reaching any feature or core files.
      if (id !== 'plugin') await this.lifecycle.stop(id)
      const configuration = !(record.preserveConfig ?? record.preserveData), history = !(record.preserveHistory ?? record.preserveData)
      if (!record.erased) {
        if (configuration || history) await this.lifecycle.eraseData(id, { configuration, history })
        record.erased = true
        await this.save()
      }
      let failed = false
      for (const file of files) { try { await removeArtifact(this.roots, file) } catch { failed = true } }
      if (failed) this.cleanupErrors.set(id, `${id.toUpperCase()}_FILE_DELETE_PENDING`)
      record.pending = failed
    } catch { this.cleanupErrors.set(id, `${id.toUpperCase()}_CLEANUP_PENDING`) }
    await this.save()
  }

  /** Called by the release transaction after all bytes and their hashes are validated. */
  async install(
    release: ModuleReleaseManifest, expectedRevision: number, restoreId: string | undefined,
    replace: (files: ModuleArtifact[], commit: (persist?: PersistModuleState) => Promise<void>, obsolete: ModuleArtifact[]) => Promise<void>,
  ): Promise<ModuleSnapshot> {
    return this.exclusive(expectedRevision, async () => {
      if (this.state.wholePlugin) throw new ModuleOperationError('PLUGIN_REMOVED')
      if (this.state.restartRequired) throw new ModuleOperationError('PLUGIN_RESTART_REQUIRED')
      const next = validateManifest(release)
      if (compareReleaseVersions(next.version, this.state.version) < 0) throw new ModuleOperationError('MODULE_DOWNGRADE_REFUSED')
      const upgrade = next.version !== this.state.version
      const owners = (manifest: ModuleReleaseManifest) => new Map([
        ...manifest.core.map(f => [`${f.root}/${f.path}`.toLowerCase(), 'core'] as const),
        ...manifest.modules.flatMap(m => m.files.map(f => [`${f.root}/${f.path}`.toLowerCase(), m.id] as const)),
      ])
      const previousOwners = owners(this.manifest)
      for (const [path, owner] of owners(next)) {
        if (previousOwners.has(path) && previousOwners.get(path) !== owner) throw new ModuleOperationError('MODULE_FILE_OWNER_CHANGED')
      }
      if (!upgrade && !sameManifest(next, this.manifest)) throw new ModuleOperationError('RELEASE_CONTENT_CHANGED')
      if (restoreId && !next.modules.some(m => m.id === restoreId)) throw new ModuleOperationError('MODULE_NOT_IN_RELEASE')
      if (restoreId && this.state.removed[restoreId]?.pending) throw new ModuleOperationError('MODULE_CLEANUP_PENDING')
      if (restoreId && this.isInstalled(restoreId)) throw new ModuleOperationError('MODULE_ALREADY_INSTALLED')
      if (!upgrade && !restoreId) return this.snapshot()
      const selected = next.modules.filter(m => m.id === restoreId || (upgrade && !this.state.removed[m.id]))
      const files = [...upgrade ? next.core : [], ...selected.flatMap(m => m.files)]
      const nextPaths = new Set([...next.core, ...next.modules.flatMap(m => m.files)].map(f => `${f.root}/${f.path}`.toLowerCase()))
      const obsolete = upgrade ? [...this.manifest.core, ...this.manifest.modules.flatMap(m => m.files)].filter(f => !nextPaths.has(`${f.root}/${f.path}`.toLowerCase())) : []
      const previous = structuredClone(this.state), previousManifest = this.manifest
      const stopped: string[] = []
      let coreStopped = false
      try {
        if (upgrade) {
          coreStopped = true
          await this.lifecycle.stopCore()
          for (const module of this.manifest.modules) {
            if (!this.isInstalled(module.id)) continue
            stopped.push(module.id)
            await this.lifecycle.stop(module.id)
          }
        }
        await replace(files, async persist => {
          for (const file of files) await verifyArtifact(this.roots, file)
          if (!upgrade && restoreId) {
            try { await this.lifecycle.start(restoreId) }
            catch {
              await this.lifecycle.stop(restoreId)
              throw new ModuleOperationError('MODULE_ACTIVATION_FAILED', 500)
            }
          }
          this.manifest = next
          this.state.manifest = next
          this.state.version = next.version
          this.state.restartRequired = upgrade
          if (restoreId) delete this.state.removed[restoreId]
          this.state.revision++
          if (persist) await persist(this.state)
          else await this.save()
        }, obsolete)
      } catch (error) {
        if (error instanceof ModuleRollbackError || error instanceof ModuleCommittedError) {
          this.state.restartRequired = true
          throw error
        }
        this.state = previous
        this.manifest = previousManifest
        await this.save()
        if (!upgrade && restoreId) await this.lifecycle.stop(restoreId)
        for (const id of stopped) await this.lifecycle.start(id)
        if (coreStopped) await this.lifecycle.startCore()
        throw error
      }
      for (const module of selected) this.unavailable.delete(module.id)
      return this.snapshot()
    })
  }

  private save(): Promise<void> { return atomicJson(this.stateFile, this.state) }
  private async exclusive<T>(revision: number, action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new ModuleOperationError('MODULE_OPERATION_BUSY')
    if (!Number.isSafeInteger(revision) || revision !== this.state.revision) throw new ModuleOperationError('MODULE_STATE_CONFLICT')
    this.busy = true
    try {
      return await withFileLock(this.stateFile, async () => {
        const disk: unknown = JSON.parse(await readFile(this.stateFile, 'utf8'))
        if (JSON.stringify(disk) !== JSON.stringify(this.state)) throw new ModuleOperationError('MODULE_STATE_CONFLICT')
        return action()
      })
    } finally { this.busy = false }
  }
}

/** Release identity does not depend on JSON object or artifact listing order. */
function sameManifest(left: ModuleReleaseManifest, right: ModuleReleaseManifest): boolean {
  const files = (items: ModuleArtifact[]) => items.map(f => [f.root, f.path, f.sha256, f.size]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const canonical = (manifest: ModuleReleaseManifest) => JSON.stringify({ version: manifest.version, core: files(manifest.core),
    modules: manifest.modules.map(m => ({ id: m.id, files: files(m.files) })).sort((a, b) => a.id.localeCompare(b.id)) })
  return canonical(left) === canonical(right)
}
