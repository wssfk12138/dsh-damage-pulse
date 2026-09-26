import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const runtime = join(repo, 'runtime')
const manifestPath = join(runtime, 'manifest.json')
const checks = new Map()
const check = (label, value) => checks.set(label, Boolean(value))
const readText = path => readFileSync(path, 'utf8')
const exists = path => existsSync(path)
const readJson = path => JSON.parse(readText(path))

check('package metadata and version', packageJson.name === 'dsh-damage-pulse' && /^\d+\.\d+\.\d+$/.test(packageJson.version))
check('package files include runtime and assets', packageJson.files?.includes('runtime/**/*') && packageJson.files?.includes('assets/**/*'))
check('runtime manifest exists', exists(manifestPath))
let manifest
try { manifest = readJson(manifestPath) } catch { manifest = undefined }
check('manifest version matches package', manifest?.version === packageJson.version)
check('manifest has core and five modules', Array.isArray(manifest?.core) && Array.isArray(manifest?.modules) && ['pet', 'overview', 'notify', 'billing', 'wechat'].every(id => manifest.modules.some(module => module.id === id)))

const owners = new Map()
for (const pair of [['core', manifest?.core], ...(manifest?.modules ?? []).map(module => [module.id, module.files])]) {
  const owner = pair[0], files = pair[1]
  if (!Array.isArray(files)) continue
  for (const file of files) {
    const key = file.root + '/' + file.path
    const previous = owners.get(key)
    owners.set(key, previous ? previous + ',' + owner : owner)
    const target = join(runtime, file.root, file.path)
    const bytes = exists(target) ? readFileSync(target) : undefined
    check('manifest file exists: ' + key, bytes !== undefined)
    if (bytes) check('manifest size/hash: ' + key, bytes.length === file.size && createHash('sha256').update(bytes).digest('hex') === file.sha256)
  }
}
check('manifest file ownership is unique', [...owners.values()].every(value => !value.includes(',')))
check('runtime host modules exist', ['manager', 'core', 'pet', 'overview', 'notify', 'billing', 'wechat'].every(id => exists(join(runtime, 'host', id + '.mjs'))))
check('runtime client exists', exists(join(runtime, 'client', 'client.js')))

const host = ['manager', 'core', 'pet', 'overview', 'notify', 'billing', 'wechat'].map(id => readText(join(runtime, 'host', id + '.mjs'))).join('\n')
const client = readText(join(runtime, 'client', 'client.js'))
const sourceClient = (() => {
  const root = join(repo, 'packages/client/ui-token-monitor/src')
  const files = []
  const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path) } }
  walk(root)
  return files.map(readText).join('\n')
})()
const sourceHost = readText(join(repo, 'plugins/dsh-token-monitor/src/migration.ts'))
const wechatSource = ['connection.ts', 'index.ts', 'sender.ts', 'tools.ts'].map(name => readText(join(repo, 'plugins/wechat-notify/src', name))).join('\n')
check('host routes cover settings, budget, usage, billing, and notifications', ['/api/token-monitor/settings', '/api/token-monitor/daily-budget', '/api/token-monitor/usage-summary', '/api/token-monitor/billing', '/api/token-monitor/notification-events', '/api/token-monitor/charge-events'].every(path => host.includes(path)))
check('secure asset routes', host.includes('/assets/dsh-token-monitor/\${directory}') && host.includes('settings-ui/cute') && host.includes('whale-girl') && host.includes('kind: "prefix"'))
check('host billing and usage implementations', host.includes('summarizeUsage') && host.includes('billing') && host.includes('sourceEventSeq'))
check('WeChat route paths and tool names', ['/api/token-monitor/wechat', '/status', '/login', '/confirm', '/reconnect', '/disconnect', '/test'].every(marker => host.includes(marker)) && ['wechat_notify', 'wechat_login', 'wechat_login_confirm'].every(marker => wechatSource.includes(marker)))
check('WeChat source uses CLI environment', wechatSource.includes('WECHAT_NOTIFY_CLAWBOT_INDEX') && wechatSource.includes('wechat_notify') && !wechatSource.includes('cli-in-wechat-v1'))
check('client loader and complete interaction markers', client.includes('__ModuleLoader__') && client.includes('WhaleGirlStage') && client.includes('revive-recharge') && client.includes('/api/token-monitor/charge-events') && client.includes('conversation.session.header.actions') && client.includes('sidebar.workspaces.sessionRow.trailing'))
check('client bundle reflects source session and module markers', ['WhaleGirlStage', 'wechatNotificationsEnabled', 'aria-selected', 'sidebar.workspaces.sessionRow.trailing'].every(marker => sourceClient.includes(marker) && client.includes(marker)))
// The standard package ships only the files listed in package.json, so the
// client bundle has to own its styles. An extracted lib/style.css never
// reaches the browser and leaves every hashed class without its rules.
check('client bundle carries its own compiled styles', client.includes('dataset.pluginCss') && /\.\w{4,10}_\w+\{/.test(client))
check('no extracted stylesheet left for the client', !exists(join(repo, 'lib', 'style.css')))
check('migration keeps events compatibility', sourceHost.includes("'events' in result") || sourceHost.includes('"events" in result'))
check('notification defaults are explicit and public-safe', readText(join(repo, 'packages/util/token-monitor-contract/src/index.ts')).includes('DEFAULT_TOKEN_MONITOR_SETTINGS') && readText(join(repo, 'packages/util/token-monitor-contract/src/index.ts')).includes('budgetExceededNotificationEnabled: false'))
check('no private absolute paths in packaged runtime', ![host, client, JSON.stringify(manifest)].some(value => /(?:[A-Z]:\\Users\\|C:\\Users\\|E:\\Codex\\)/i.test(value)))

for (const [label, ok] of checks) console.log('[' + (ok ? 'OK' : 'FAILED') + '] ' + label)
if ([...checks.values()].some(value => !value)) process.exitCode = 1
