import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const { satisfies } = createRequire(import.meta.url)('semver') as {
  satisfies: (version: string, range: string, options: { includePrerelease: boolean }) => boolean
}

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
    assert.equal(satisfies(fixture.dshVersion, range, { includePrerelease: true }), true, `${name} does not accept DSH ${fixture.dshVersion}: ${range}`)
  }
})

test('official 0.1.3 prerelease support preserves the Desktop 0.1.2 line', () => {
  // Check the accepted host versions, including prereleases, rather than the
  // spelling of equivalent declarations used by marketplace discovery.
  for (const [name, range] of Object.entries<string>(manifest.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/dsh-')) continue
    for (const version of ['0.1.2-alpha.1', '0.1.2-rc.1', '0.1.3-alpha.1']) {
      assert.equal(satisfies(version, range, { includePrerelease: true }), true, name + ' must accept ' + version)
    }
  }
})
