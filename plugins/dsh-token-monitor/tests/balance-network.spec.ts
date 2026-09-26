import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { publicBalanceAddress, requestBalanceJson } from '../src/balance-network.ts'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('node:https', () => ({ request: vi.fn() }))
const descriptor = { path: '/balance', method: 'GET' as const, auth: 'bearer' as const }
let status: number, chunks: Buffer[], headers: Record<string, string>
let options: Record<string, unknown>, destination: URL
let response: EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: ReturnType<typeof vi.fn> }

beforeEach(() => {
  status = 200; chunks = [Buffer.from('{"total":12}')]; headers = {}
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never)
  vi.mocked(request).mockImplementation(((url: URL, config: Record<string, unknown>, callback: (value: unknown) => void) => {
    destination = url; options = config
    response = Object.assign(new EventEmitter(), { statusCode: status, headers, destroy: vi.fn() })
    const req = Object.assign(new EventEmitter(), { end: () => {
      callback(response)
      if (response.destroy.mock.calls.length) return
      for (const chunk of chunks) response.emit('data', chunk)
      response.emit('end')
    } })
    return req
  }) as never)
})
afterEach(() => { vi.resetAllMocks() })

it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '100.64.0.1'])('rejects non-public address %s', address => {
  expect(publicBalanceAddress(address)).toBe(false)
})

it('rejects mixed public/private DNS answers before credentials are attached', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] as never)
  await expect(requestBalanceJson(descriptor, 'https://balance.example', 'test-key', new AbortController().signal)).rejects.toThrow('public')
  expect(request).not.toHaveBeenCalled()
})

it('pins the checked address while keeping the original TLS hostname and bounded signal', async () => {
  expect(await requestBalanceJson(descriptor, 'https://balance.example', 'test-key', new AbortController().signal)).toEqual({ total: 12 })
  expect(destination.hostname).toBe('balance.example')
  expect(options.agent).toBe(false)
  expect(options.signal).toBeInstanceOf(AbortSignal)
  expect(options.headers).toMatchObject({ Authorization: 'Bearer test-key', 'Accept-Encoding': 'identity' })
  const pinnedLookup = options.lookup as (host: string, opts: { all: boolean }, cb: (...values: unknown[]) => void) => void
  const callback = vi.fn()
  pinnedLookup('balance.example', { all: false }, callback)
  expect(callback).toHaveBeenLastCalledWith(null, '8.8.8.8', 4)
  pinnedLookup('balance.example', { all: true }, callback)
  expect(callback).toHaveBeenLastCalledWith(null, [{ address: '8.8.8.8', family: 4 }])
})

it('rejects redirects without forwarding credentials to the new destination', async () => {
  status = 302; headers = { location: 'https://other.example/' }
  await expect(requestBalanceJson(descriptor, 'https://balance.example', 'test-key', new AbortController().signal)).rejects.toThrow('302')
  expect(request).toHaveBeenCalledOnce()
  expect(response.destroy).toHaveBeenCalled()
})

it('limits response bytes and rejects compressed or malformed data', async () => {
  chunks = [Buffer.alloc(262145)]
  await expect(requestBalanceJson(descriptor, 'https://balance.example', 'test-key', new AbortController().signal)).rejects.toThrow('256 KiB')
  headers = { 'content-encoding': 'gzip' }
  await expect(requestBalanceJson(descriptor, 'https://balance.example', 'test-key', new AbortController().signal)).rejects.toThrow('Compressed')
  headers = {}; chunks = [Buffer.from('not JSON')]
  await expect(requestBalanceJson(descriptor, 'https://balance.example', 'test-key', new AbortController().signal)).rejects.toThrow('not JSON')
})

it('cancels while DNS is unresolved without starting a request', async () => {
  vi.mocked(lookup).mockReturnValue(new Promise(() => {}))
  const controller = new AbortController()
  const pending = requestBalanceJson(descriptor, 'https://balance.example', 'test-key', controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow('cancelled')
  expect(request).not.toHaveBeenCalled()
})
