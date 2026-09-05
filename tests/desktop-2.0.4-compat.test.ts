import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const fixture = JSON.parse(readFileSync(new URL('./fixtures/dsh-desktop-2.0.4-client-packages.json', import.meta.url), 'utf8'))
const clientBundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('Desktop 2.0.4 can resolve the complete client injection graph', () => {
  const available = new Set(fixture.clientPackages as string[])
  const inject = manifest.dsh?.client?.inject ?? []
  const missing = inject.filter((name: string) => !available.has(name))
  assert.deepEqual(missing, [], `Desktop ${fixture.desktopVersion} is missing injected packages: ${missing.join(', ')}`)
})

test('Desktop 2.0.4 removed modules cannot leak into the product contract', () => {
  for (const name of fixture.removedPackages as string[]) {
    assert.ok(!manifest.dsh?.client?.inject?.includes(name), `${name} must not be injected`)
    assert.equal(manifest.peerDependencies?.[name], undefined, `${name} must not be a product peer`)
    assert.ok(!clientBundle.includes(name), `${name} must not appear in the browser bundle`)
  }
})

test('Desktop 2.0.4 prerelease is explicitly accepted by DSH peer ranges', () => {
  for (const [name, range] of Object.entries<string>(manifest.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue
    assert.ok(range.includes(`^${fixture.dshVersion}`), `${name} does not accept DSH ${fixture.dshVersion}: ${range}`)
  }
})

test('official 0.1.3 prerelease support preserves the Desktop 0.1.2 line', () => {
  // npm excludes prereleases with a different major/minor/patch tuple.
  // The 0.1.2 clause also accepts Desktop 2.0.5's 0.1.2-rc.1.
  for (const [name, range] of Object.entries<string>(manifest.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue
    const clauses = range.split('||').map(value => value.trim())
    assert.ok(clauses.includes('^0.1.2-alpha.1'), name + ' must retain Desktop support')
    assert.ok(clauses.includes('^0.1.3-alpha.1'), name + ' must accept the official prerelease')
  }
})
