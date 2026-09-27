import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { bootModules } from '../src/module-bootstrap.ts'

describe('installed payload preflight', () => {
  it('names the missing generated payload instead of surfacing a bare ENOENT', async () => {
    const pluginRoot = await mkdtemp(join(tmpdir(), 'token-monitor-boot-'))
    try {
      // A source install never runs the packaging step, so runtime/ is absent.
      // The preflight must reject before it creates the profile state directory.
      await expect(bootModules({} as unknown as Context, pluginRoot, pluginRoot)).rejects.toThrow(/runtime[\\/]manifest\.json/u)
    } finally {
      await rm(pluginRoot, { recursive: true, force: true })
    }
  })
})
