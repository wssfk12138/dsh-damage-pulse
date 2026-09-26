import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTokenMonitorAssetHandler,
  registerTokenMonitorAssetRoutes,
  TOKEN_MONITOR_ASSET_ROUTES,
} from '../src/assets.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!()
})

async function fixture(): Promise<{ root: string; png: Buffer }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-token-monitor-assets-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await writeFile(join(root, 'idle-08.png'), png)
  await writeFile(join(root, 'not-an-image.txt'), 'no')
  return { root, png }
}

async function serve(root: string): Promise<string> {
  const route = TOKEN_MONITOR_ASSET_ROUTES[0]
  const server: Server = createServer(createTokenMonitorAssetHandler(route.path, root))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  cleanup.push(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  }))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}${route.path}`
}

describe('token monitor asset routes', () => {
  it('registers the whale-girl and cute settings prefixes', () => {
    const register = vi.fn(() => vi.fn())
    registerTokenMonitorAssetRoutes({ webServer: { register } } as never, 'C:/assets')

    expect(register).toHaveBeenCalledTimes(2)
    expect(register.mock.calls.map(([route]) => route)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'prefix', path: '/assets/dsh-token-monitor/whale-girl' }),
      expect.objectContaining({ kind: 'prefix', path: '/assets/dsh-token-monitor/settings-ui/cute' }),
    ]))
  })

  it('serves PNG bytes and supports HEAD without a response body', async () => {
    const { root, png } = await fixture()
    const endpoint = await serve(root)

    const getResponse = await fetch(`${endpoint}/idle-08.png`)
    expect(getResponse.status).toBe(200)
    expect(getResponse.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await getResponse.arrayBuffer())).toEqual(png)

    const headResponse = await fetch(`${endpoint}/idle-08.png`, { method: 'HEAD' })
    expect(headResponse.status).toBe(200)
    expect(headResponse.headers.get('content-length')).toBe(String(png.byteLength))
    expect(await headResponse.text()).toBe('')
  })

  it.each([
    '/missing.png',
    '/not-an-image.txt',
    '/../idle-08.png',
    '/%2e%2e%2fidle-08.png',
    '/subdir\\idle-08.png',
  ])('rejects missing or unsafe asset path %s', async (suffix) => {
    const { root } = await fixture()
    const endpoint = await serve(root)
    expect((await fetch(`${endpoint}${suffix}`)).status).toBe(404)
  })

  it('rejects unsupported methods', async () => {
    const { root } = await fixture()
    const endpoint = await serve(root)
    const response = await fetch(`${endpoint}/idle-08.png`, { method: 'POST' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })
})
