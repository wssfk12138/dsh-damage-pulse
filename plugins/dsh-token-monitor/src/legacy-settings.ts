/** Import the retired settings document without modifying its recovery copy. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { TokenMonitorSettingsPatch } from '@deepseek-ai/dsh-token-monitor-contract'
import { TOKEN_MONITOR_INTERNAL_FIELDS, TOKEN_MONITOR_VOLATILE_FIELDS } from './config-base.ts'
import type { TokenMonitorStore, TokenMonitorStoreDocument } from './plugin-store.ts'

/** Copy owned state first; the caller writes preferences after its entry becomes active. */
export async function prepareLegacySettings(home: string, store: TokenMonitorStore): Promise<TokenMonitorSettingsPatch | undefined> {
  if (store.get().legacyMigrationVersion === 1) return undefined
  let document: Record<string, Record<string, unknown>> | undefined
  for (const filename of ['settings.yaml', 'settings.yaml.imported']) {
    let source: string
    try { source = await readFile(join(home, filename), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    document = parse(source)
    break
  }
  const legacy = document?.['dsh-token-monitor']
  if (legacy === undefined) return undefined
  if (typeof legacy !== 'object' || legacy === null || Array.isArray(legacy)) throw new TypeError('Invalid legacy token monitor settings')
  const internal: Partial<TokenMonitorStoreDocument> = {}
  const preferences: TokenMonitorSettingsPatch = {}
  for (const [key, value] of Object.entries(legacy)) {
    if (TOKEN_MONITOR_INTERNAL_FIELDS.includes(key) && key !== 'schemaVersion' && store.revision === 0) Reflect.set(internal, key, value)
    if (TOKEN_MONITOR_VOLATILE_FIELDS.includes(key)) Reflect.set(preferences, key, value)
  }
  if (Object.keys(internal).length) await store.update(internal)
  return preferences
}
