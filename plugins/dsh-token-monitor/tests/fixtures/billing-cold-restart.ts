import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { emptyBillingRule, type BillingSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'
import { attachCollector } from '../../src/collector.ts'
import { appendUsageRecord } from '../collector-appender.ts'
import { UsageStorage } from '../../src/storage.ts'
import { PRICE_TABLE } from '../../src/pricing.ts'
import { createTokenCostProjectionDefinition } from '../../src/projection.ts'

const [phase, directory] = process.argv.slice(2)
if (!directory || !['write', 'restore'].includes(phase ?? '')) throw new Error('Expected phase and private data directory')
const ctx = new Context()
await ctx.plugin(SessionStore)
try {
  const snapshot: BillingSnapshot = { revision: phase === 'write' ? 1 : 2, rules: { version: 1, providers: [{
    provider: 'test-provider', enabled: true, models: [{ ...emptyBillingRule('test-model'),
      multiplier: phase === 'write' ? 2 : 3,
      fixed: { input: phase === 'write' ? 5 : 10, cacheHit: 1, output: 2 },
    }],
  }] } }
  const storage = new UsageStorage(() => true, directory)
  attachCollector(ctx, storage, PRICE_TABLE, { readBilling: () => snapshot, appendUsageRecord })
  const eventsPath = join(directory, 'events.json')
  const events = phase === 'restore' ? JSON.parse(readFileSync(eventsPath, 'utf8')) : []
  const session = ctx.sessions.create(SessionId('billing-cold-restart'), { seed: events })
  const before = storage.history()
  const append = () => session.append('assistant/message', {
    stream: [], turn: 1, step: phase === 'write' ? 1 : 2,
    message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'fixture' }],
      source: { kind: 'model', provider: 'test-provider', model: 'test-model' } }),
    usage: { inputTokens: 1_000_000, outputTokens: 0 },
  }, { surfaceOp: 'append' })
  append()
  await new Promise<void>(resolve => queueMicrotask(resolve))
  const persistedEvents = session.snapshotEvents()
  writeFileSync(eventsPath, JSON.stringify(persistedEvents), 'utf8')
  const definition = createTokenCostProjectionDefinition(PRICE_TABLE)
  let projected = definition.init()
  for (const event of persistedEvents) projected = definition.apply(projected, event)
  writeFileSync(join(directory, `${phase}.json`), JSON.stringify({
    pid: process.pid, before, records: storage.history(), summary: storage.get(session.id), projected,
    ledgerEvents: persistedEvents.filter(event => event.type === 'token-usage/record').length,
  }), 'utf8')
} finally {
  await ctx.fiber.dispose()
}
