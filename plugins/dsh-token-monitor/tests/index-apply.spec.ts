import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import { bootModules } from '../src/module-bootstrap.ts'
vi.mock('../src/module-bootstrap.ts', () => ({ bootModules: vi.fn(async () => {}) }))

describe('plugin source entrypoint', () => {
  it('loads the installed payload roots without regenerating optional modules', async () => {
    const ctx = {
      effect: vi.fn(),
      inject: vi.fn(),
      on: vi.fn(),
      // sessions 是 apply 声明的必需注入（inject 数组形式即非空拦截），只有 webServer 等宿主集成可选。
      sessions: { list: () => [] },
      settings: { describe: () => [] },
    } as unknown as Context

    await apply(ctx, {} as never)
    expect(bootModules).toHaveBeenCalledWith(ctx, expect.stringMatching(/[\\/]plugins[\\/]dsh-token-monitor$/), expect.stringMatching(/[\\/]packages[\\/]client[\\/]ui-token-monitor[\\/]lib$/))
  })
})
