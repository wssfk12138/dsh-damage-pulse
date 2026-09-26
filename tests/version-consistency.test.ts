import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url)
function readRelative(relativePath: string): string { return readFileSync(new URL(relativePath, ROOT), 'utf8') }
const manifestText = readRelative('package.json')
const manifest = JSON.parse(manifestText) as { version: string; devDependencies: Record<string, string> }
const modulePanelSource = readRelative('packages/client/ui-token-monitor/src/client/ModuleManagerPanel.tsx')
const updateSource = readRelative('plugins/dsh-token-monitor/src/update.ts')

test('root package.json devDependencies declare @deepseek-ai/dsh-llm exactly once', () => {
  const devSection = manifestText.split('"devDependencies"')[1]
  assert.equal(devSection.split('"@deepseek-ai/dsh-llm"').length - 1, 1)
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-llm'], '0.1.7-alpha.2')
})

test('module manager and Host CURRENT_RELEASE_VERSION match the root package version contract', () => {
  const versionParts = manifest.version.split('.')
  assert.equal(versionParts.length, 3)
  for (const part of versionParts) assert.ok(Number.isInteger(Number(part)))
  assert.ok(modulePanelSource.includes('snapshot.version'))
  assert.ok(modulePanelSource.includes('modulesVersion'))
  const currentAnchor = "CURRENT_RELEASE_VERSION = '"
  const currentStart = updateSource.indexOf(currentAnchor)
  assert.ok(currentStart >= 0, 'update.ts should export CURRENT_RELEASE_VERSION')
  assert.equal(updateSource.slice(currentStart + currentAnchor.length, currentStart + currentAnchor.length + manifest.version.length), manifest.version)
})
