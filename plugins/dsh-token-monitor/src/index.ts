/** Installed entry: loads verified modular payloads without recreating removed features. */
import type { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bootModules } from './module-bootstrap.ts'
import { registerUserSettings } from './user-settings.ts'
import type { TokenMonitorUserConfig } from './config-base.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '../../wechat-notify/src/connection.ts'

export const name = 'dsh-token-monitor'
export { Config } from './config-base.ts'
export const inject = ['sessions', 'credentials', 'settings']

/** Start the installed release; a whole-plugin tombstone leaves this loader inert.
 * @param ctx Host-owned plugin lifetime.
 */
export async function apply(ctx: Context, config: TokenMonitorUserConfig): Promise<void> {
  registerUserSettings(ctx, config)
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  // Source checkouts keep the browser bundle beside the workspace package. A
  // packed install has no workspace tree, so prefer the installed runtime/client
  // payload and fall back to the monolithic package lib directory.
  const sourceClient = resolve(pluginRoot, '../../packages/client/ui-token-monitor/lib')
  const runtimeClient = resolve(pluginRoot, 'runtime/client')
  const packagedClient = resolve(pluginRoot, 'lib')
  const isSourceTree = pluginRoot.replaceAll('\\', '/').endsWith('/plugins/dsh-token-monitor')
  const clientRoot = existsSync(runtimeClient) ? runtimeClient : isSourceTree ? sourceClient : packagedClient
  await bootModules(ctx, pluginRoot, clientRoot)
}
