import test from 'node:test'
import assert from 'node:assert/strict'
import * as tokenMonitorPlugin from '../lib/index.js'

test('built entry exposes the modular loader contract', () => {
  assert.equal(tokenMonitorPlugin.name, 'dsh-token-monitor')
  assert.deepEqual(tokenMonitorPlugin.inject, ['sessions', 'credentials', 'settings'])
  assert.equal(typeof tokenMonitorPlugin.apply, 'function')
})

test('modular loader does not expose removed monolithic capabilities', () => {
  assert.equal('tokenMonitorWechat' in tokenMonitorPlugin, false)
})
