import test from 'node:test'
import assert from 'node:assert/strict'
// Import the built artifact (not source); its expected public shape comes from source.
const tokenMonitorPlugin = await import(new URL('../lib/index.js', import.meta.url).href) as typeof import('../plugins/dsh-token-monitor/src/index.ts')

test('built entry exposes the modular loader contract', () => {
  assert.equal(tokenMonitorPlugin.name, 'dsh-token-monitor')
  assert.deepEqual(tokenMonitorPlugin.inject, ['sessions', 'credentials', 'settings'])
  assert.equal(typeof tokenMonitorPlugin.apply, 'function')
})

test('modular loader does not expose removed monolithic capabilities', () => {
  assert.equal('tokenMonitorWechat' in tokenMonitorPlugin, false)
})
