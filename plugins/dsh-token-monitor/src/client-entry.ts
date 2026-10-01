import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'
import type { ModuleReleaseManifest } from '@deepseek-ai/dsh-token-monitor-contract'
import { confinedPath, verifyArtifact, type ArtifactRoots } from './module-files.ts'

/**
 * The desktop discovers lib/client.js from package exports, while installed
 * module updates replace runtime/client/client.js. Keep the static entry a
 * verified mirror of that single, self-contained bundle before services start.
 * This lives in the updatable manager, not the old package's frozen loader, so
 * 4.2.1 installations can receive the repair through their existing updater.
 * The boot lease excludes concurrent writers. A same-directory rename either
 * leaves the old entry or commits the complete new one; retry is idempotent.
 */
export async function synchronizeClientEntry(roots: ArtifactRoots, manifest: ModuleReleaseManifest): Promise<void> {
  const pluginRoot = resolve(roots.host, '../..')
  if (resolve(roots.host) !== resolve(pluginRoot, 'runtime/host')
    || resolve(roots.client) !== resolve(pluginRoot, 'runtime/client')) return
  let pkg: { name?: string; exports?: Record<string, unknown> }
  try { pkg = JSON.parse(await readFile(await confinedPath(pluginRoot, 'package.json'), 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  if (pkg.name !== 'dsh-damage-pulse') return
  const entry = pkg.exports?.['./client']
  if (entry === './runtime/client/client.js') return
  if (entry !== './lib/client.js') throw new Error('UNSUPPORTED_INSTALLED_CLIENT_ENTRY')
  const artifact = manifest.core.find(file => file.root === 'client' && file.path === 'client.js')
  if (!artifact) throw new Error('CLIENT_ENTRY_NOT_IN_MANIFEST')
  await verifyArtifact(roots, artifact)
  // Check ancestors from the package root, including lib itself.
  const target = await confinedPath(pluginRoot, 'lib/client.js')
  const mirrorRoots = { ...roots, client: resolve(pluginRoot, 'lib') }
  try { await verifyArtifact(mirrorRoots, artifact); return }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT'
      && (error as Error).message !== 'ARTIFACT_DIGEST_MISMATCH') throw error
  }
  const temporaryArtifact = { ...artifact, path: `client.js.${randomUUID()}.tmp` }
  const temporary = await confinedPath(mirrorRoots.client, temporaryArtifact.path)
  await mkdir(mirrorRoots.client, { recursive: true })
  try {
    await copyFile(await confinedPath(roots.client, artifact.path), temporary, constants.COPYFILE_EXCL)
    await verifyArtifact(mirrorRoots, temporaryArtifact)
    await rename(temporary, target)
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}
