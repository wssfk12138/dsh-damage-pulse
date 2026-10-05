import assert from 'node:assert/strict'
import test from 'node:test'
// Import the built artifact (not source); its expected public shape comes from source.
const tokenMonitorPlugin = await import(new URL('../lib/index.js', import.meta.url).href) as typeof import('../plugins/dsh-token-monitor/src/index.ts')

test('built Host entry links without the removed settingsNamespace helper', () => {
  assert.equal(typeof tokenMonitorPlugin.apply, 'function')
  assert.equal(typeof tokenMonitorPlugin.name, 'string')
})
