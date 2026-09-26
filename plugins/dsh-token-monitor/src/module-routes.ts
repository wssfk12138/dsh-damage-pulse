/** Authenticated management operations never invoke a shell or an installer script. */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage } from 'node:http'
import type { ModuleRestoreRequest, ModuleUninstallRequest } from '@deepseek-ai/dsh-token-monitor-contract'
import { createRouteGuard } from './http-trust.ts'
import { ModuleManager, ModuleOperationError } from './module-manager.ts'
import { ModuleReleases, artifactKey } from './module-releases.ts'
import { compareReleaseVersions, validModuleId } from './module-files.ts'
import { replaceModuleArtifacts } from './module-transaction.ts'
import { ModuleWork } from './module-work.ts'

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new ModuleOperationError('UNSUPPORTED_MEDIA_TYPE', 415)
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > 16 * 1024) throw new ModuleOperationError('PAYLOAD_TOO_LARGE', 413)
    chunks.push(bytes)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch { /* Report malformed JSON without reflecting request contents. */ }
  throw new ModuleOperationError('INVALID_JSON', 400)
}

export function registerModuleRoutes(ctx: Context, manager: ModuleManager, stateFile: string, releases = new ModuleReleases()): void {
  const guard = createRouteGuard(ctx), work = new ModuleWork()
  let busy = false
  ctx.effect(() => () => work.stop(), 'token-monitor: management requests')
  const install = async (expectedRevision: number, restore?: ModuleRestoreRequest) => {
    const current = manager.snapshot(), list = await releases.list()
    const release = restore && !restore.upgrade ? list.find(r => r.version === current.version) : list[0]
    if (!release) throw new ModuleOperationError('MODULE_RELEASE_UNAVAILABLE')
    if (restore?.upgrade && compareReleaseVersions(release.version, current.version) <= 0) throw new ModuleOperationError('NO_NEWER_RELEASE')
    const manifest = await releases.manifest(release)
    if (!manifest) throw new ModuleOperationError('MODULE_RELEASE_UNAVAILABLE')
    const upgrade = compareReleaseVersions(manifest.version, current.version) > 0
    if (!upgrade && !restore) return current
    const owners = [...upgrade ? ['core'] : [], ...manifest.modules.filter(m => m.id === restore?.id || upgrade && !manager.autoInstallBlocked(m.id)).map(m => m.id)]
    const bytes = await releases.prepare(release, manifest, owners)
    return manager.install(manifest, expectedRevision, restore?.id, (files, commit, obsolete) =>
      replaceModuleArtifacts(stateFile, manager.roots, files, async file => {
        const data = bytes.get(artifactKey(file))
        if (!data) throw new Error('MODULE_PACK_FILE_MISSING')
        return data
      }, commit, obsolete))
  }
  for (const action of ['', '/uninstall', '/check', '/update', '/restore-plan', '/restore']) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: `/api/token-monitor/modules${action}`, handler: async (req, res) => {
      if (!guard(req, res)) return
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value))
      }
      if (req.method !== (action ? 'POST' : 'GET')) { json(405, { error: { code: 'METHOD_NOT_ALLOWED' } }); return }
      if (!action) { json(200, manager.snapshot()); return }
      if (busy) { json(409, { error: { code: 'MODULE_OPERATION_BUSY' } }); return }
      busy = true
      try {
        const value = await work.run(async () => {
          const body = await readBody(req), current = manager.snapshot()
          if (action === '/uninstall') return manager.uninstall(body as unknown as ModuleUninstallRequest)
          if (current.pluginRemoved) throw new ModuleOperationError('PLUGIN_REMOVED')
          if (action === '/update' || action === '/restore') {
            if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== current.revision) throw new ModuleOperationError('MODULE_STATE_CONFLICT')
            if (action === '/restore' && (!validModuleId(body.id) || !current.modules.some(module => module.id === body.id) || typeof body.upgrade !== 'boolean')) throw new ModuleOperationError('INVALID_MODULE_REQUEST', 400)
            return install(body.expectedRevision as number, action === '/restore' ? body as unknown as ModuleRestoreRequest : undefined)
          }
          const list = await releases.list(), latest = list[0]
          if (!latest) throw new ModuleOperationError('MODULE_RELEASE_UNAVAILABLE')
          const hasUpdate = compareReleaseVersions(latest.version, current.version) > 0
          if (action === '/check') return { currentVersion: current.version, latestVersion: latest.version, hasUpdate, compatible: !!await releases.manifest(latest) }
          if (!validModuleId(body.id) || !current.modules.some(m => m.id === body.id)) throw new ModuleOperationError('INVALID_MODULE_REQUEST', 400)
          const same = list.find(r => r.version === current.version), manifest = same ? await releases.manifest(same) : undefined
          return { id: body.id, currentVersion: current.version, latestVersion: latest.version, hasUpdate, currentAvailable: !!manifest?.modules.some(m => m.id === body.id) }
        })
        json(200, value)
      } catch (error) {
        const code = error instanceof Error && /^[A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'MODULE_OPERATION_FAILED'
        const errno = (error as NodeJS.ErrnoException)?.code
        const diagnostic = [new Date().toISOString(), action.slice(1), code, typeof errno === 'string' && /^[A-Z0-9_]+$/.test(errno) ? errno : ''].filter(Boolean).join(' | ')
        json(error instanceof ModuleOperationError ? error.httpStatus : 500, { error: { code, diagnostic } })
      } finally { busy = false }
    } }), `token-monitor: module ${action || 'snapshot'} route`)
  }
}
