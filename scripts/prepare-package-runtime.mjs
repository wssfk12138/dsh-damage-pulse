/**
 * Materialize the verified modular payload inside the package root immediately
 * before packing. The installed loader resolves runtime/ relative to the
 * package root, so a tgz must carry the same manifest, host modules, client
 * bundle, and assets that were exercised in the release smoke.
 *
 * runtime/ is generated and ignored; it is never a source of truth and is
 * never copied from an installed home or a private fixture.
 */
import { rm, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const runtime = resolve(repo, 'runtime')
await rm(runtime, { recursive: true, force: true })
await mkdir(runtime, { recursive: true })
const script = resolve(repo, 'plugins/dsh-token-monitor/build-modules.mjs')
const child = spawn(process.execPath, [script, runtime], { cwd: repo, stdio: 'inherit', env: process.env })
const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)))
})
if (exitCode !== 0) throw new Error(`modular package runtime build failed with exit code ${String(exitCode)}`)
