import assert from 'node:assert/strict'
import test from 'node:test'
import * as tokenMonitorPlugin from '../lib/index.js'

test('built Host entry links without the removed settingsNamespace helper', () => {
  assert.equal(typeof tokenMonitorPlugin.apply, 'function')
  assert.equal(typeof tokenMonitorPlugin.name, 'string')
})
