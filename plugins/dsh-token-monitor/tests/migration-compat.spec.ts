import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { migrateMissingTokenCost } from '../src/migration.ts'

const header = { id: 'session-14' }
const inspection = {
  meta: { id: 'session-14', version: 1 },
  events: [{ seq: 0, type: 'session/start' }],
}

function migrationContext(coldSnapshot: Function, inspect = vi.fn(async () => inspection)): Context {
  return {
    sessionPersistence: {
      list: vi.fn(async () => [header]),
      inspect,
    },
    sessionProjectionCache: {
      cachedSnapshot: vi.fn(() => undefined),
      coldSnapshot,
    },
  } as unknown as Context
}

describe('historical tokenCost migration compatibility', () => {
  it('keeps the 0.1.0/0.1.1 async coldSnapshot(id) contract', async () => {
    const calls: unknown[][] = []
    async function coldSnapshot(...args: unknown[]) {
      calls.push(args)
      return { values: {} }
    }
    const inspect = vi.fn(async () => inspection)

    await migrateMissingTokenCost(migrationContext(coldSnapshot, inspect))

    expect(calls).toEqual([['session-14']])
    expect(inspect).not.toHaveBeenCalled()
  })

  it('accepts a transpiled legacy function that returns a Promise', async () => {
    const coldSnapshot = vi.fn((id: unknown) => Promise.resolve({ id }))
    const inspect = vi.fn(async () => inspection)

    await migrateMissingTokenCost(migrationContext(coldSnapshot, inspect))

    expect(coldSnapshot).toHaveBeenCalledWith('session-14')
    expect(inspect).not.toHaveBeenCalled()
  })

  it('uses inspect metadata and events for the 0.1.2 synchronous contract', async () => {
    const coldSnapshot = vi.fn((_meta: unknown, events?: unknown) => {
      if (events === undefined) throw new TypeError("Cannot read properties of undefined (reading 'at')")
      return { values: {} }
    })
    const inspect = vi.fn(async () => inspection)

    await migrateMissingTokenCost(migrationContext(coldSnapshot, inspect))

    expect(inspect).toHaveBeenCalledWith('session-14')
    expect(coldSnapshot).toHaveBeenCalledWith(inspection.meta, inspection.events)
    expect(coldSnapshot).toHaveBeenNthCalledWith(1, 'session-14')
    expect(coldSnapshot).toHaveBeenNthCalledWith(2, inspection.meta, inspection.events)
  })

  it('does not reinterpret unrelated synchronous failures as the new contract', async () => {
    const coldSnapshot = vi.fn(() => {
      throw new Error('storage unavailable')
    })
    const inspect = vi.fn(async () => inspection)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await migrateMissingTokenCost(migrationContext(coldSnapshot, inspect))

    expect(inspect).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('storage unavailable'))
    warn.mockRestore()
  })
})
