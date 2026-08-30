import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

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
  }
})

test("legacy client runtime stays development-only", () => {
  assert.equal(manifest.peerDependencies["@deepseek-ai/dsh-client-runtime"], undefined)
  assert.ok(!manifest.dsh?.client?.inject?.includes("@deepseek-ai/dsh-client-runtime"))
  assert.ok(manifest.devDependencies?.["@deepseek-ai/dsh-client-runtime"], "legacy registry regression needs a pinned devDependency")
})

test("dsh-tools is declared as a peer and pinned for development builds", () => {
  assert.equal(manifest.peerDependencies["@deepseek-ai/dsh-tools"], "^0.1.0-rc.5 || ^0.1.1-rc.2 || ^0.1.2-alpha.1")
  assert.ok(manifest.devDependencies?.["@deepseek-ai/dsh-tools"], "dsh-tools devDependency must be pinned")
})
