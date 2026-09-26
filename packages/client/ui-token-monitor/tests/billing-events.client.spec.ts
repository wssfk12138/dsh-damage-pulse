import { afterEach, expect, it, vi } from 'vitest'
import { createBillingEvents } from '../src/client/billingEvents.ts'

afterEach(() => vi.unstubAllGlobals())

it('closes billing streams on removal, ignores queued messages and reconnects only after restoration', () => {
  const streams: Array<{ onmessage?: (event: { data: string }) => void; close: ReturnType<typeof vi.fn> }> = []
  vi.stubGlobal('EventSource', class {
    onmessage?: (event: { data: string }) => void
    close = vi.fn()
    constructor() { streams.push(this) }
  })
  const source = createBillingEvents()
  source.setEnabled(false)
  const dispose = source.subscribe(vi.fn())
  expect(streams).toHaveLength(0)
  source.setEnabled(true)
  expect(streams).toHaveLength(1)
  source.setEnabled(false)
  expect(streams[0]!.close).toHaveBeenCalledOnce()
  streams[0]!.onmessage!({ data: 'malformed' })
  expect(source.getSnapshot()).toEqual({ invalid: false })
  source.setEnabled(true)
  expect(streams).toHaveLength(2)
  streams[1]!.onmessage!({ data: 'malformed' })
  expect(source.getSnapshot().invalid).toBe(true)
  source.setEnabled(false)
  expect(source.getSnapshot()).toEqual({ invalid: false })
  dispose()
  source.dispose()
  source.setEnabled(true)
  source.subscribe(vi.fn())
  expect(streams).toHaveLength(2)
})
