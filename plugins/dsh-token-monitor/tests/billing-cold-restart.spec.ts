import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execute = promisify(execFile)

it('restores frozen ledger records in a new process and charges only new session events', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-billing-cold-restart-'))
  const root = resolve(import.meta.dirname, '../../..')
  const fixture = resolve(import.meta.dirname, 'fixtures/billing-cold-restart.ts')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key)))
  env.TSX_TSCONFIG_PATH = join(root, 'tsconfig.base.json')
  env.DSH_HOME = directory
  for (const phase of ['write', 'restore']) {
    await execute(process.execPath, ['--import', 'tsx/esm', fixture, phase, directory], {
      cwd: root, env, timeout: 20_000, windowsHide: true, maxBuffer: 1024 * 1024,
    })
  }
  const written = JSON.parse(readFileSync(join(directory, 'write.json'), 'utf8'))
  const restored = JSON.parse(readFileSync(join(directory, 'restore.json'), 'utf8'))
  expect(restored.pid).not.toBe(written.pid)
  expect(written.records).toHaveLength(1)
  expect(written.records[0]).toMatchObject({ cost: 10, billingRuleVersion: 1, modelMultiplier: 2 })
  expect(restored.before).toEqual(written.records)
  expect(restored.records).toHaveLength(2)
  expect(restored.records[0]).toEqual(written.records[0])
  expect(restored.records[1]).toMatchObject({ cost: 30, billingRuleVersion: 2, modelMultiplier: 3 })
  expect(restored.ledgerEvents).toBe(2)
  expect(restored.summary).toMatchObject({ calls: 2, cost: 40, inputTokens: 2_000_000 })
  expect(restored.projected).toMatchObject({ calls: 2, cost: 40, inputTokens: 2_000_000 })
  expect(readFileSync(join(directory, 'usage.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2)
}, 45_000)
