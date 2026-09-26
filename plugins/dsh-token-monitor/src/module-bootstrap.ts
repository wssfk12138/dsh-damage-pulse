/** This small loader stays inert after whole-plugin removal; it never regenerates deleted files. */
import type { Context } from '@deepseek-ai/cordis'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { recoverModuleTransaction } from './module-transaction.ts'
import { validateManifest, verifyArtifact, type ArtifactRoots } from './module-files.ts'
import { ModuleManager } from './module-manager.ts'
import type * as Runtime from './runtime-host.ts'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { eraseRemovedPlugin } from './module-cleanup.ts'
import { acquireModuleLease, recoverModuleLock } from './module-lease.ts'

export async function bootModules(ctx: Context, pluginRoot: string, clientRoot: string): Promise<void> {
  const runtime = resolve(pluginRoot, 'runtime'), stateFile = resolve(runtime, 'state.json')
  const roots: ArtifactRoots = { host: resolve(runtime, 'host'), assets: resolve(runtime, 'assets'), client: clientRoot }
  await mkdir(runtime, { recursive: true })
  const releaseLease = await acquireModuleLease(stateFile)
  ctx.effect(() => releaseLease, 'token-monitor: exclusive installed runtime')
  await recoverModuleLock(stateFile)
  const { manifest, removed } = await withFileLock(stateFile, async () => {
    await recoverModuleTransaction(stateFile, roots)
    let state: { manifest?: unknown; wholePlugin?: unknown } | undefined
    try { state = JSON.parse(await readFile(stateFile, 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const manifest = validateManifest(state?.manifest ?? JSON.parse(await readFile(resolve(runtime, 'manifest.json'), 'utf8')))
    if (!state?.wholePlugin) for (const file of manifest.core) await verifyArtifact(roots, file)
    return { manifest, removed: !!state?.wholePlugin }
  })
  if (removed) {
    // Teardown and erasure precede deletion. A restart only retries remaining locked payload files.
    await ModuleManager.open(manifest, stateFile, roots, {
      stop: async () => {}, start: async () => {}, stopCore: async () => {}, startCore: async () => {},
      // The whole-plugin record is authoritative; partial feature cleanup is subsumed.
      eraseData: async (id, selection) => { if (id === 'plugin' && selection) await eraseRemovedPlugin(ctx, dshHomePath('data', 'dsh-token-monitor'), selection) },
    })
    return
  }
  const entry: typeof Runtime = await import(pathToFileURL(resolve(roots.host, 'manager.mjs')).href + `?v=${manifest.version}`)
  await entry.apply(ctx, { roots, stateFile, manifest })
}
