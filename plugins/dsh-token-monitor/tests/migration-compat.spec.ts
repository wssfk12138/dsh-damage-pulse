import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { migrateMissingTokenCost } from '../src/migration.ts'

const header = { id: 'session-14' }
const inspection = {
  meta: { id: 'session-14', version: 1 },
  inheritedEventCount: 2,
  events: [
    { seq: 0, type: 'session/start' },
    { seq: 1, type: 'session/end-seed' },
    { seq: 2, type: 'session/start' },
  ],
}

function migrationContext(
  coldSnapshot: Function,
  inspect = vi.fn(async () => inspection),
  cachedSnapshot: Function = vi.fn(() => undefined),
  list = vi.fn(async () => [header]),
): Context {
  return {
    sessionPersistence: {
      list,
      inspect,
    },
    sessionProjectionCache: {
      cachedSnapshot,
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

  it('uses the exact inherited event count with the 0.1.2-rc.1 contract', async () => {
    const coldSnapshot = vi.fn(function (_meta: unknown, _inheritedEventCount: unknown, _events: unknown) {
      return { values: {} }
    })
    const cachedSnapshot = vi.fn(function (_meta: unknown, inheritedEventCount?: unknown) {
      if (inheritedEventCount === undefined) {
        throw new TypeError('SessionLogOffset must be a non-negative safe integer, got undefined')
      }
      return undefined
    })
    const inspect = vi.fn(async () => inspection)
    const list = vi.fn(async () => [{ header, revision: 'r1' }])

    await migrateMissingTokenCost(migrationContext(coldSnapshot, inspect, cachedSnapshot, list))

    expect(inspect).toHaveBeenCalledWith('session-14')
    expect(cachedSnapshot).toHaveBeenCalledWith(inspection.meta, inspection.inheritedEventCount)
    expect(coldSnapshot).toHaveBeenCalledWith(
      inspection.meta,
      inspection.inheritedEventCount,
      inspection.events,
    )
  })

  it('reads current sessions through a read handle and closes it', async () => {
    const close = vi.fn(async () => {})
    const read = vi.fn(async () => inspection.events)
    const open = vi.fn(async () => ({
      header: inspection.meta,
      inheritedEventCount: inspection.inheritedEventCount,
      read,
      close,
    }))
    const coldSnapshot = vi.fn(function (_meta: unknown, _inheritedEventCount: unknown, _events: unknown) {})
    const cachedSnapshot = vi.fn(function (_meta: unknown, _inheritedEventCount: unknown) {
      return undefined
    })
    const ctx = {
      sessionPersistence: {
        list: vi.fn(async () => [{ header, revision: 'r1' }]),
        open,
      },
      sessionProjectionCache: { cachedSnapshot, coldSnapshot },
    } as unknown as Context

    await migrateMissingTokenCost(ctx)

    expect(open).toHaveBeenCalledWith('session-14', 'read')
    expect(read).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(coldSnapshot).toHaveBeenCalledWith(
      inspection.meta,
      inspection.inheritedEventCount,
      inspection.events,
    )
  })

  it('does not rebuild a cached current tokenCost projection', async () => {
    const coldSnapshot = vi.fn(function (_meta: unknown, _inheritedEventCount: unknown, _events: unknown) {})
    const cachedSnapshot = vi.fn(function (_meta: unknown, _inheritedEventCount: unknown) {
      return { values: { tokenCost: { cny: 1 } } }
    })
    const inspect = vi.fn(async () => inspection)

    await migrateMissingTokenCost(migrationContext(
      coldSnapshot,
      inspect,
      cachedSnapshot,
      vi.fn(async () => [{ header, revision: 'r1' }]),
    ))

    expect(inspect).toHaveBeenCalledTimes(1)
    expect(coldSnapshot).not.toHaveBeenCalled()
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

  it('continues after one session fails and counts only successful migrations', async () => {
    const failedHeader = { id: 'session-failed' }
    const successfulHeader = { id: 'session-successful' }
    const failedInspection = { ...inspection, meta: { ...inspection.meta, id: failedHeader.id } }
    const successfulInspection = { ...inspection, meta: { ...inspection.meta, id: successfulHeader.id } }
    const inspect = vi.fn(async (id: unknown) => {
      if (id === failedHeader.id) return failedInspection
      return successfulInspection
    })
    const coldSnapshot = vi.fn(function (meta: { id: string }, _inheritedEventCount: unknown, _events: unknown) {
      if (meta.id === failedHeader.id) throw new Error('broken historical session')
    })
    const cachedSnapshot = vi.fn(function (_meta: unknown, _inheritedEventCount: unknown) {
      return undefined
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await migrateMissingTokenCost(migrationContext(
      coldSnapshot,
      inspect,
      cachedSnapshot,
      vi.fn(async () => [failedHeader, successfulHeader]),
    ))

    expect(coldSnapshot).toHaveBeenCalledTimes(2)
    expect(coldSnapshot).toHaveBeenLastCalledWith(
      successfulInspection.meta,
      successfulInspection.inheritedEventCount,
      successfulInspection.events,
    )
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('broken historical session'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('1 个历史会话'))
    warn.mockRestore()
    log.mockRestore()
  })
})
