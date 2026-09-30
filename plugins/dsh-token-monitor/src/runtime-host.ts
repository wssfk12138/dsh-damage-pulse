/** Awaited Cordis child lifetimes connect physical payloads to live services. */
import type { Context } from '@deepseek-ai/cordis'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ModuleReleaseManifest } from '@deepseek-ai/dsh-token-monitor-contract'
import { TOKEN_MONITOR_ASSET_BASE } from '@deepseek-ai/dsh-token-monitor-contract'
import type { ModuleServices, RuntimeFeature } from './module-services.ts'
import type * as Core from './runtime-core.ts'
import type { ArtifactRoots } from './module-files.ts'
import { ModuleManager, type ModuleLifecycle } from './module-manager.ts'
import { registerModuleRoutes } from './module-routes.ts'
import { createTokenMonitorAssetHandler } from './assets.ts'

export interface RuntimeOptions {
  roots: ArtifactRoots
  stateFile: string
  manifest: ModuleReleaseManifest
  /** Source-plane tests supply actual source modules without consuming built output. */
  loadCore?: () => Promise<typeof Core>
  loadFeature?: (id: string) => Promise<RuntimeFeature>
  dataDir?: string
  /** 服务构造注入点；缺省由 core 在宿主上下文里自建。 */
  services?: (ctx: Context) => Promise<ModuleServices>
}
// Cordis treats a plugin apply() return value as an effect: returning a plain
// object throws TypeError: Invalid effect. Lifecycle here is registered through
// ctx.effect / ctx.inject, so the entry point deliberately yields nothing.
export async function apply(ctx: Context, options: RuntimeOptions): Promise<void> {
  const { roots, stateFile, manifest } = options
  const core: typeof Core = options.loadCore ? await options.loadCore() : await import(pathToFileURL(resolve(roots.host, 'core.mjs')).href + `?v=${manifest.version}`)
  const services = options.services !== undefined
    ? await options.services(ctx)
    : await core.createServices(ctx, roots.assets, options.dataDir ?? dshHomePath('data', 'dsh-token-monitor'))
  type Child = ReturnType<Context['plugin']>
  const children = new Map<string, Child>()
  let coreChild: Child | undefined, coreRuntime: ReturnType<typeof core.apply> | undefined
  let manager: ModuleManager
  const lifecycle: ModuleLifecycle = {
    async start(id) {
      if (children.has(id)) return
      const feature: RuntimeFeature = options.loadFeature ? await options.loadFeature(id) : await import(pathToFileURL(resolve(roots.host, `${id}.mjs`)).href + `?v=${manifest.version}`)
      const child = ctx.plugin({ name: `token-monitor-${id}`, apply: (scope: Context) => feature.apply(scope, services) })
      children.set(id, child)
      try { await child.await() } catch (error) { await child.dispose(); children.delete(id); throw error }
    },
    async stop(id) {
      await coreRuntime?.drainSettings()
      const child = children.get(id)
      if (child) { await child.dispose(); children.delete(id) }
    },
    async startCore() {
      if (coreChild) return
      coreChild = ctx.plugin({ name: 'token-monitor-background-core', apply(scope: Context) { coreRuntime = core.apply(scope, services, id => manager.isInstalled(id)) } })
      await coreChild.await()
    },
    async stopCore() {
      if (coreChild) { await coreChild.dispose(); coreChild = undefined; coreRuntime = undefined }
    },
    async eraseData(id, selection = { configuration: true, history: true }) {
      const resume = !!coreChild && id !== 'plugin'
      if (selection.history) await lifecycle.stopCore()
      try { await core.eraseData(ctx, services, id, selection) }
      finally { if (selection.history && resume) await lifecycle.startCore() }
    },
  }
  manager = await ModuleManager.open(manifest, stateFile, roots, lifecycle)
  ctx.inject(['webServer'], web => {
    for (const directory of ['settings-ui/cute', 'whale-girl']) {
      // The desktop shell answers every /assets/** request from its own frozen
      // front-end bundle, so plugin images must live under their own
      // document-relative prefix to reach this Host at all.
      const path = `${TOKEN_MONITOR_ASSET_BASE}/${directory}`
      const serve = createTokenMonitorAssetHandler(path, resolve(roots.assets, directory))
      web.effect(() => web.webServer.register({ kind: 'prefix', path, handler: (req, res) => {
        if (manager.snapshot().pluginRemoved && !manager.snapshot().cleanupPending || directory === 'whale-girl' && !manager.isInstalled('pet')) { res.writeHead(404); res.end(); return }
        return serve(req, res)
      } }), 'token-monitor: owned asset route')
    }
  })
  if (!manager.snapshot().pluginRemoved) {
    // Pricing and observation are available before raw capture can receive an event.
    const ordered = new Set(['wechat', 'billing', 'notify', 'overview', 'pet', ...manifest.modules.map(module => module.id)])
    for (const id of ordered) if (manager.isInstalled(id)) await lifecycle.start(id)
    await lifecycle.startCore()
  }
  ctx.inject(['webServer', 'connection'], web => registerModuleRoutes(web, manager, stateFile, undefined, () => services))
}
