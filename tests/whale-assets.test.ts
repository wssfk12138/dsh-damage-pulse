import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { TOKEN_MONITOR_WHALE_ASSET_BASE } from '@deepseek-ai/dsh-token-monitor-contract'
import { createTokenMonitorAssetHandler } from '../plugins/dsh-token-monitor/src/assets.ts'

type CapturedResponse = { status?: number; headers?: Record<string, string | number>; body?: unknown }
function captureHandler() { return createTokenMonitorAssetHandler(TOKEN_MONITOR_WHALE_ASSET_BASE, resolve(process.cwd(), 'assets/dsh-token-monitor/whale-girl')) }
async function request(method: string, url: string): Promise<CapturedResponse> {
  const result: CapturedResponse = {}
  const res = {
    writeHead(status: number, headers?: Record<string, string | number>) { result.status = status; result.headers = headers },
    end(body?: unknown) { result.body = body },
  }
  await captureHandler()({ method, url } as never, res as never)
  return result
}

test('serves an allowlisted whale PNG', async () => {
  const response = await request('GET', `${TOKEN_MONITOR_WHALE_ASSET_BASE}/idle.png`)
  assert.equal(response.status, 200)
  assert.equal(response.headers?.['Content-Type'], 'image/png')
  assert.ok(Buffer.isBuffer(response.body))
})
test('serves severe expression assets', async () => {
  const response = await request('GET', `${TOKEN_MONITOR_WHALE_ASSET_BASE}/critical-pain.png`)
  assert.equal(response.status, 200)
  assert.equal(response.headers?.['Content-Type'], 'image/png')
  assert.ok(Buffer.isBuffer(response.body))
})
test('supports HEAD without returning the PNG body', async () => {
  const response = await request('HEAD', `${TOKEN_MONITOR_WHALE_ASSET_BASE}/idle.png`)
  assert.equal(response.status, 200)
  assert.equal(response.body, undefined)
  assert.ok(Number(response.headers?.['Content-Length']) > 0)
})
test('rejects traversal, unknown files and unsupported methods', async () => {
  assert.equal((await request('GET', `${TOKEN_MONITOR_WHALE_ASSET_BASE}/%2e%2e/package.json`)).status, 404)
  assert.equal((await request('GET', `${TOKEN_MONITOR_WHALE_ASSET_BASE}/not-allowed.png`)).status, 404)
  assert.equal((await request('POST', `${TOKEN_MONITOR_WHALE_ASSET_BASE}/idle.png`)).status, 405)
})
test('rejects malformed URL encoding without exposing an error', async () => {
  const response = await request('GET', `${TOKEN_MONITOR_WHALE_ASSET_BASE}/%E0%A4%A`)
  assert.equal(response.status, 404)
  assert.equal(response.body, undefined)
})
