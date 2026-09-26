/** Permanent tombstone cleanup; does not load or recreate any removed runtime. */
import type { Context } from '@deepseek-ai/cordis'
import { unlink } from 'node:fs/promises'
import { confinedPath } from './module-files.ts'

export async function eraseRemovedPlugin(ctx: Context, dataDir: string, selection: { configuration: boolean; history: boolean }): Promise<void> {
  if (selection.configuration) {
    // 用户偏好由 profile patch 承载；条目已随插件一起卸载时没有可寻址的 namespace。
    if (ctx.get('settings') !== undefined && ctx.settings.describe().some(item => item.ns === 'dsh-token-monitor')) {
      const descriptor = ctx.settings.describe().find(item => item.ns === 'dsh-token-monitor')
      const value = descriptor?.value
      const fields = value && typeof value === 'object' && !Array.isArray(value)
        ? Object.keys(value).filter(key => key !== 'providerNotifications')
        : []
      const paths = fields.map(key => ({ op: 'unset' as const, path: [key] }))
      if (value && typeof value === 'object' && !Array.isArray(value) && 'providerNotifications' in value) {
        paths.push({ op: 'unset', path: ['providerNotifications'] })
      }
      if (paths.length) await ctx.settings.mutate('dsh-token-monitor', paths)
    }
    // 插件自有账本与历史一并落在数据目录里。
    for (const name of ['state.json', 'state.json.lock']) {
      try { await unlink(await confinedPath(dataDir, name)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  }
  if (selection.history) for (const name of ['usage.jsonl', 'request-details.jsonl']) {
    try { await unlink(await confinedPath(dataDir, name)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}
