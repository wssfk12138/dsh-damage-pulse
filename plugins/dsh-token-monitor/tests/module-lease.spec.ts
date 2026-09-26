import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { acquireModuleLease, recoverModuleLock } from '../src/module-lease.ts'

it('excludes a second runtime and releases ownership after shutdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'module-lease-')), state = join(root, 'state.json')
  try {
    const release = await acquireModuleLease(state)
    try { await expect(acquireModuleLease(state)).rejects.toThrow('MODULE_RUNTIME_ALREADY_ACTIVE') }
    finally { await release() }
    await (await acquireModuleLease(state))()
    await writeFile(state + '.lock', `${process.pid}\n`)
    await expect(recoverModuleLock(state)).rejects.toThrow('MODULE_LOCK_OWNER_ACTIVE')
    expect(await readFile(state + '.lock', 'utf8')).toBe(`${process.pid}\n`)
  } finally { await rm(root, { recursive: true, force: true }) }
})
