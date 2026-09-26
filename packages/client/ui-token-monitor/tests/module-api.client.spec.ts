import { afterEach, expect, it, vi } from 'vitest'
import { createModuleState, moduleApi, moduleInstalled } from '../src/client/moduleApi.ts'
const installed = { schemaVersion: 1, revision: 0, version: '4.0.3', pluginRemoved: false, restartRequired: false, modules: [{ id: 'pet', status: 'installed', autoInstallBlocked: false }] }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })
it('rejects malformed and duplicate installation state instead of enabling features', async () => {
  for (const value of [{}, { ...installed, revision: -1 }, { ...installed, modules: [installed.modules[0], installed.modules[0]] }, { ...installed, version: '4.0.3-rc.1' }]) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value))))
    await expect(moduleApi.snapshot()).rejects.toThrow('INVALID_MODULE_RESPONSE')
  }
  expect(moduleInstalled(undefined, 'pet')).toBe(false)
})
it('shares an in-flight refresh and aborts it when the source is disposed', async () => {
  let signal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })))
  const source = createModuleState()
  const first = source.refresh(), second = source.refresh()
  expect(first).toBe(second)
  const settled = expect(first).rejects.toMatchObject({ name: 'AbortError' })
  source.dispose()
  await settled
  expect(signal?.aborted).toBe(true)
  expect(fetch).toHaveBeenCalledOnce()
  expect(source.getSnapshot()).toBeUndefined()
})
it('retains confirmed state on network failure and isolates subscriber exceptions', async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const transport = vi.fn(async () => new Response(JSON.stringify(installed)))
  vi.stubGlobal('fetch', transport)
  const source = createModuleState(), observed = vi.fn()
  source.subscribe(() => { throw new Error('listener') })
  source.subscribe(observed)
  await source.refresh()
  expect(observed).toHaveBeenCalledOnce()
  const confirmed = source.getSnapshot()
  transport.mockRejectedValueOnce(new Error('offline'))
  await expect(source.refresh()).rejects.toThrow('offline')
  expect(source.getSnapshot()).toBe(confirmed)
  expect(moduleInstalled(confirmed, 'pet')).toBe(true)
  source.dispose()
  await vi.advanceTimersByTimeAsync(5000)
  expect(transport).toHaveBeenCalledTimes(2)
})
