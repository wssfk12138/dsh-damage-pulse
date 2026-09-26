/** Real optional source modules, isolated payload bytes, no dependency on a build. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleArtifact } from '@deepseek-ai/dsh-token-monitor-contract'
import { apply } from '../src/runtime-host.ts'
import { CURRENT_RELEASE_VERSION } from '../src/update.ts'

export async function sourceRuntime(root: string) {
  const runtime = join(root, 'runtime')
  const roots = { host: join(runtime, 'host'), client: join(runtime, 'client'), assets: join(runtime, 'assets') }
  await Promise.all(Object.values(roots).map(path => mkdir(path, { recursive: true })))
  const artifact = (id: string): ModuleArtifact => ({ root: 'host', path: id + '.mjs', size: 7, sha256: createHash('sha256').update('fixture').digest('hex') })
  const ids = ['pet', 'overview', 'notify', 'billing', 'wechat']
  const manifest = { schemaVersion: 1 as const, version: CURRENT_RELEASE_VERSION, core: [artifact('core')], modules: ids.map(id => ({ id, files: [artifact(id)] })) }
  for (const file of [...manifest.core, ...manifest.modules.flatMap(m => m.files)]) {
    try { await writeFile(join(roots.host, file.path), 'fixture', { flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  return { name: 'dsh-token-monitor', inject: ['sessions', 'credentials', 'settings'], async apply(ctx: Context) {
    await apply(ctx, { roots, stateFile: join(runtime, 'state.json'), manifest, dataDir: join(root, 'data/dsh-token-monitor'),
      loadCore: () => import('../src/runtime-core.ts'), loadFeature: id => import(`../src/features/${id}.ts`) })
  } }
}
