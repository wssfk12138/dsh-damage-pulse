import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

interface Manifest {
  peerDependencies: Record<string, string>
  devDependencies?: Record<string, string>
  dsh?: { client?: { inject?: string[] } }
}

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as Manifest

const WIRE_CONTRACT_PEERS = [
  "@deepseek-ai/dsh-session",
  "@deepseek-ai/dsh-session-persistence",
  "@deepseek-ai/dsh-session-projection",
  "@deepseek-ai/dsh-session-projection-cache",
] as const

const DUAL_RANGE_PEERS = [
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-layout",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-tools",
] as const

test("wire-contract peers support DSH 0.1.1-rc.2 and never falsely claim 0.1.0-rc.8", () => {
  for (const name of WIRE_CONTRACT_PEERS) {
    const range = manifest.peerDependencies[name]
    assert.ok(range, `${name} must be declared in peerDependencies`)
    assert.ok(range.includes("0.1.1-rc.2"), `${name} must allow DSH 0.1.1-rc.2, got ${range}`)
    assert.ok(!range.includes("0.1.0-rc.8"), `${name} must not claim DSH 0.1.0-rc.8, got ${range}`)
  }
})

test("client and tools peers keep all supported compatibility legs", () => {
  for (const name of DUAL_RANGE_PEERS) {
    const range = manifest.peerDependencies[name]
    assert.ok(range, `${name} must be declared in peerDependencies`)
    assert.ok(range.includes("0.1.0-rc.5") || range.includes("0.1.0-rc.7"), `${name} should keep the older-client leg, got ${range}`)
    assert.ok(range.includes("0.1.1-rc.2"), `${name} should also allow DSH 0.1.1-rc.2, got ${range}`)
    assert.ok(range.includes("0.1.2-alpha.1"), `${name} should allow DSH Desktop 2.0.4, got ${range}`)
    assert.ok(range.includes("0.1.7-rc.2"), `${name} should allow the newest DSH prerelease, got ${range}`)
    assert.ok(range.includes("0.1.6-alpha.1"), `${name} should allow DSH 0.1.6 alpha hosts, got ${range}`)
  }
})

test("legacy client runtime stays development-only", () => {
  assert.equal(manifest.peerDependencies["@deepseek-ai/dsh-client-runtime"], undefined)
  assert.ok(!manifest.dsh?.client?.inject?.includes("@deepseek-ai/dsh-client-runtime"))
  assert.ok(manifest.devDependencies?.["@deepseek-ai/dsh-client-runtime"], "legacy registry regression needs a pinned devDependency")
})

test("dsh-tools is declared as a peer and pinned for development builds", () => {
  assert.equal(manifest.peerDependencies["@deepseek-ai/dsh-tools"], "^0.1.0-rc.5 || ^0.1.1-rc.2 || ^0.1.2-alpha.1 || ^0.1.3-alpha.1 || ^0.1.5-alpha.1 || ^0.1.6-alpha.1 || ^0.1.7-rc.2 || 0.2.0-rc.2 || 0.2.1-rc.1 || 0.2.1-rc.2 || 0.2.1-rc.3 || 0.2.1-rc.4 || 0.2.1-rc.5 || 0.2.2-alpha.2 || 0.2.2-alpha.2-ce7073d-dirty || 0.2.2-alpha.3 || 0.2.2-rc.1")
  assert.ok(manifest.devDependencies?.["@deepseek-ai/dsh-tools"], "dsh-tools devDependency must be pinned")
})

test("current desktop peers admit only the verified 0.2 prereleases", () => {
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (!name.startsWith("@deepseek-ai/dsh-")) continue
    assert.ok(range.split(" || ").includes("0.2.0-rc.2"), name)
    assert.ok(range.split(" || ").includes("0.2.1-rc.1"), name)
    assert.ok(range.split(" || ").includes("0.2.1-rc.2"), name)
    assert.ok(range.split(" || ").includes("0.2.1-rc.3"), name)
    assert.ok(range.split(" || ").includes("0.2.1-rc.4"), name)
    assert.ok(range.split(" || ").includes("0.2.1-rc.5"), name)
    assert.ok(range.split(" || ").includes("0.2.2-alpha.2"), name)
    assert.ok(range.split(" || ").includes("0.2.2-alpha.2-ce7073d-dirty"), name)
    assert.ok(range.split(" || ").includes("0.2.2-alpha.3"), name)
    assert.ok(range.split(" || ").includes("0.2.2-rc.1"), name)

    assert.ok(!range.includes("^0.2"), name)
  }
})

test("0.2.2 peers list exactly the known hosts and reject every other 0.2.2 build", () => {
  const { satisfies } = createRequire(import.meta.url)("semver") as {
    satisfies: (version: string, range: string, options?: { includePrerelease?: boolean }) => boolean
  }
  const accepted = ["0.2.2-alpha.2", "0.2.2-alpha.2-ce7073d-dirty", "0.2.2-alpha.3", "0.2.2-rc.1", "0.2.1-rc.5"]
  const rejected = ["0.2.2-alpha.4", "0.2.2-alpha.999", "0.2.2-beta.1", "0.2.2-preview.1", "0.2.2-alpha.2-ce7073d", "0.2.2-alpha.2-x", "0.2.2-rc.2", "0.2.2", "0.2.3-alpha.1", "0.3.0", "0.2.0-alpha.1", "0.2.1-rc.6"]
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (!name.startsWith("@deepseek-ai/dsh-")) continue
    for (const version of accepted) {
      assert.equal(satisfies(version, range, { includePrerelease: true }), true, `${name} must accept ${version}: ${range}`)
    }
    for (const version of rejected) {
      assert.equal(satisfies(version, range, { includePrerelease: true }), false, `${name} must not claim ${version}: ${range}`)
    }
  }
})

test("the reported local build is pinned exactly instead of widening the alpha range", () => {
  const { satisfies } = createRequire(import.meta.url)("semver") as {
    satisfies: (version: string, range: string, options?: { includePrerelease?: boolean }) => boolean
  }
  const dirty = "0.2.2-alpha.2-ce7073d-dirty"
  assert.equal(satisfies(dirty, "0.2.2-alpha.2", { includePrerelease: true }), false, "exact pin misses local builds")
  assert.equal(satisfies(dirty, "0.2.2-alpha.2-ce7073d-dirty", { includePrerelease: true }), true)
  assert.equal(satisfies("0.2.2-alpha.4", "0.2.2-alpha.2-ce7073d-dirty", { includePrerelease: true }), false)
  assert.equal(satisfies("0.2.2-rc.1", "0.2.2-rc.1", { includePrerelease: true }), true)
})
