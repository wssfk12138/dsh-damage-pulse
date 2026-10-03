import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { emptyBillingRule, type BillingSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attachCollector } from '../src/collector.ts'
import { UsageStorage } from '../src/storage.ts'
import { PRICE_TABLE } from '../src/pricing.ts'
import { normalizeUsageRecord, isValidUsageRecord } from '../src/types.ts'
import { resetCharges } from '../src/charge.ts'

const fileAccess = vi.hoisted(() => ({
  allowedDirectory: '',
  attempts: [] as { operation: string; allowed: boolean }[],
}))

vi.mock('@deepseek-ai/dsh-home-paths', async () => {
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  return { dshHomePath: (...parts: string[]) => join(tmpdir(), 'billing-default-denied', ...parts) }
})

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const { isAbsolute, relative, resolve, sep } = await import('node:path')
  function guard(operation: string, target: import('node:fs').PathLike | number): void {
    const difference = typeof target === 'string' && fileAccess.allowedDirectory
      ? relative(fileAccess.allowedDirectory, resolve(target)) : undefined
    const allowed = difference !== undefined && !isAbsolute(difference)
      && difference !== '..' && !difference.startsWith('..' + sep)
    fileAccess.attempts.push({ operation, allowed })
    if (!allowed) throw new Error('Test denied storage access outside its temporary directory')
  }
  const guarded = {
    ...actual,
    mkdirSync: (...args: Parameters<typeof actual.mkdirSync>) => { guard('mkdir', args[0]); return actual.mkdirSync(...args) },
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => { guard('read', args[0]); return actual.readFileSync(...args) },
    appendFileSync: (...args: Parameters<typeof actual.appendFileSync>) => { guard('append', args[0]); return actual.appendFileSync(...args) },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => { guard('write', args[0]); return actual.writeFileSync(...args) },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => { guard('rename-source', args[0]); guard('rename-target', args[1]); return actual.renameSync(...args) },
    unlinkSync: (...args: Parameters<typeof actual.unlinkSync>) => { guard('unlink', args[0]); return actual.unlinkSync(...args) },
  }
  return { ...guarded, default: guarded }
})

beforeEach(() => {
  fileAccess.allowedDirectory = ''
  fileAccess.attempts.length = 0
  resetCharges()
})

const rules: BillingSnapshot = { revision: 7, rules: { version: 1, providers: [
  { provider: 'deepseek-official', enabled: true, models: [{ ...emptyBillingRule('deepseek-v4-flash'), fixed: { input: 99, cacheHit: 99, output: 99 } }] },
  { provider: 'deepseek-account', enabled: true, models: [{ ...emptyBillingRule('deepseek-v4-flash'), fixed: { input: 2, cacheHit: 1, cacheWrite: 2, output: 4 } }] },
] } }

describe('B07-B08 collector uses model-source provider and durable required identities', () => {
  it('denies a missing data-directory argument before any default storage read or write', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const storage = new UsageStorage(() => true)
      expect(storage.history()).toEqual([])
      expect(fileAccess.attempts).toEqual([
        { operation: 'mkdir', allowed: false }, { operation: 'read', allowed: false },
      ])
      const forbidden = join(tmpdir(), 'billing-default-denied', 'usage.jsonl')
      expect(() => mkdirSync(forbidden)).toThrow('Test denied storage access')
      expect(() => readFileSync(forbidden)).toThrow('Test denied storage access')
      expect(() => appendFileSync(forbidden, 'synthetic')).toThrow('Test denied storage access')
    } finally {
      warning.mockRestore()
    }
  })

  it('selects the explicit account instead of the official owner, without adding reasoning to output', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'billing-caller-'))
    fileAccess.allowedDirectory = directory
    const ctx = new Context()
    const sessions = ctx.plugin(SessionStore)
    let collector: ReturnType<Context['plugin']> | undefined
    try {
      await sessions
      const storage = new UsageStorage(() => true, directory)
      collector = ctx.plugin({ apply(scope: Context) {
        attachCollector(scope, storage, PRICE_TABLE, { readBilling: () => rules })
      } })
      await collector
      const session = ctx.sessions.create()
      session.append('assistant/message', { stream: [], turn: 1, step: 1,
        message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'synthetic' }], source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-v4-flash' } }),
        usage: { inputTokens: 100_000, cacheReadTokens: 200_000, cacheWriteTokens: 50_000, outputTokens: 70_000, reasoningTokens: 30_000 },
      }, { surfaceOp: 'append' })
      await new Promise<void>(resolve => queueMicrotask(resolve))
      expect(storage.history()).toHaveLength(1)
      const record = storage.history()[0]!
      expect(record).toMatchObject({ provider: 'deepseek-account', model: 'deepseek-v4-flash', billingStatus: 'priced', outputTokens: 70_000, reasoningTokens: 30_000 })
      expect(record.cost * 1_000_000).toBeCloseTo(780_000, 6)
      expect(storage.list()[0]).toMatchObject({ calls: 1, totalTokens: 420_000 })
      const durable = readFileSync(join(directory, 'usage.jsonl'), 'utf8')
      expect(durable.trim().split('\n')).toHaveLength(1)
      expect(JSON.parse(durable)).toEqual(record)
      expect(fileAccess.attempts.every(attempt => attempt.allowed)).toBe(true)
      for (const key of ['provider', 'model']) {
        const invalid: Record<string, unknown> = JSON.parse(JSON.stringify(record))
        delete invalid[key]
        const normalized = normalizeUsageRecord(invalid)
        expect(normalized !== undefined && isValidUsageRecord(normalized)).toBe(false)
      }
      await collector.dispose()
      collector = undefined
      session.append('assistant/message', { stream: [], turn: 1, step: 2,
        message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'after disposal' }], source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-v4-flash' } }),
        usage: { inputTokens: 100_000, cacheReadTokens: 200_000, cacheWriteTokens: 50_000, outputTokens: 70_000, reasoningTokens: 30_000 },
      }, { surfaceOp: 'append' })
      await new Promise<void>(resolve => queueMicrotask(resolve))
      expect(storage.history()).toHaveLength(1)
      expect(readFileSync(join(directory, 'usage.jsonl'), 'utf8')).toBe(durable)
    } finally {
      try {
        await collector?.dispose()
        await sessions.dispose()
      } finally {
        resetCharges()
        rmSync(directory, { recursive: true, force: true })
        fileAccess.allowedDirectory = ''
      }
    }
  })
})
