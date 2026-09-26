/** Confined artifact I/O shared by uninstall and release installation. No shell commands. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { ModuleArtifact, ModuleReleaseManifest } from '@deepseek-ai/dsh-token-monitor-contract'

export type ArtifactRoots = Record<ModuleArtifact['root'], string>
const ROOTS = new Set(['host', 'client', 'assets'])
const MAX_BYTES = 250 * 1024 * 1024
export const validModuleId = (id: unknown): id is string => typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id) && !['core', 'plugin', 'constructor', 'prototype'].includes(id)
export const validReleaseVersion = (version: unknown): version is string => typeof version === 'string' && version.length < 48 && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)

export function compareReleaseVersions(a: string, b: string): number {
  if (!validReleaseVersion(a) || !validReleaseVersion(b)) throw new Error('INVALID_RELEASE_VERSION')
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! > right[i]! ? 1 : -1
  return 0
}

export function validateManifest(value: unknown): ModuleReleaseManifest {
  const v = value as ModuleReleaseManifest
  if (!v || v.schemaVersion !== 1 || !validReleaseVersion(v.version) || !Array.isArray(v.core) || !v.core.length || !Array.isArray(v.modules) || v.modules.length > 64) throw new Error('INVALID_MODULE_MANIFEST')
  const ids = new Set<string>(), paths = new Set<string>()
  let size = 0, count = 0
  const files = (list: ModuleArtifact[]) => {
    if (!Array.isArray(list) || !list.length) throw new Error('EMPTY_MODULE_ARTIFACTS')
    for (const f of list) {
      if (!f || !ROOTS.has(f.root) || typeof f.path !== 'string' || f.path.length > 240 || isAbsolute(f.path)
        || f.path.split('/').some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))
        || typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0) throw new Error('INVALID_MODULE_ARTIFACT')
      const key = `${f.root}/${f.path}`.toLowerCase()
      if (paths.has(key)) throw new Error('DUPLICATE_MODULE_ARTIFACT')
      paths.add(key)
      size += f.size
      if (size > MAX_BYTES || ++count > 20_000) throw new Error('MODULE_RELEASE_TOO_LARGE')
    }
  }
  files(v.core)
  for (const m of v.modules) {
    if (!m || !validModuleId(m.id) || ids.has(m.id)) throw new Error('INVALID_MODULE_ID')
    ids.add(m.id); files(m.files)
  }
  return structuredClone(v)
}

/** Reject every link-shaped ancestor, including the target. Never recurse during deletion. */
export async function confinedPath(root: string, file: string): Promise<string> {
  const base = resolve(root), target = resolve(base, file)
  const rel = relative(base, target)
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('ARTIFACT_OUTSIDE_ROOT')
  let current = base
  for (const part of ['', ...rel.split(sep)]) {
    if (part) current = resolve(current, part)
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('ARTIFACT_LINK_REFUSED')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return target
}

export async function removeArtifact(roots: ArtifactRoots, file: ModuleArtifact): Promise<void> {
  const target = await confinedPath(roots[file.root], file.path)
  try { await unlink(target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

export async function verifyArtifact(roots: ArtifactRoots, file: ModuleArtifact): Promise<void> {
  const target = await confinedPath(roots[file.root], file.path)
  const stat = await lstat(target)
  if (!stat.isFile() || stat.size !== file.size || stat.size > MAX_BYTES) throw new Error('ARTIFACT_DIGEST_MISMATCH')
  const bytes = await readFile(target)
  if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('ARTIFACT_DIGEST_MISMATCH')
}

/** Same-directory rename is the commit point; the temporary file is never a recovery package. */
export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temp, file)
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}
