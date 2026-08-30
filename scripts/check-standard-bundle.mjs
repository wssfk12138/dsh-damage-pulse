import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const settingsContract = readFileSync(new URL('../packages/util/token-monitor-contract/src/index.ts', import.meta.url), 'utf8')
const settingsAssetRoot = new URL('../assets/dsh-token-monitor/settings-ui/cute/', import.meta.url)
const settingsAssets = readdirSync(settingsAssetRoot).filter(name => name.endsWith('.png'))
const notificationDefaults = [
  'budgetExceededNotificationEnabled',
  'peakReminderEnabled',
  'peakReminderEnterPeak',
  'peakReminderEnterValley',
  'notifyOncePerTransition',
  'whaleBubbleEnabled',
  'wechatNotificationsEnabled',
  'cacheHitAnomalyNotificationEnabled',
]
const childProcessImports = host.match(/from ["']node:child_process["']/g) ?? []

// 标准包侧边栏会话金额能力：正式尾部席位 + 旧客户端 fail-closed 兼容桥。
// 这些标记同时作为产物新鲜度门禁：必须存在于当前 client 源码，且已进入构建产物；
// 若 bundle 是从旧源码构建的（缺实现或未重建），对应检查会失败。
const clientSrcRoot = fileURLToPath(new URL('../packages/client/ui-token-monitor/src/', import.meta.url))
function collectProjectSource(dir) {
  let text = ''
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) text += collectProjectSource(path)
    else if (/\.(ts|tsx)$/.test(entry.name)) text += readFileSync(path, "utf8")
  }
  return text
}
const clientSourceText = collectProjectSource(clientSrcRoot)
const sessionRowMarkers = [
  'sidebar.workspaces.sessionRow.trailing',
  'data-session-row-trailing-slot',
  '会话消费金额',
  'aria-selected',
]

const checks = {
  'dsh.bundle patch': manifest.dsh?.bundle?.patch === './cordis.patch.yml',
  'dsh.client declaration': manifest.dsh?.client?.platform === 'web',
  'package-name patch row': patch.includes('name: dsh-damage-pulse'),
  'Host plugin artifact': host.includes('dsh-damage-pulse') && host.includes('charge-events'),
  'Client ModuleLoader artifact': client.includes('__ModuleLoader__.load') && client.includes('dsh-damage-pulse'),
  'continuous damage animation': client.includes('tkm-impact-float') && client.includes('FLOAT_EMIT_INTERVAL_MS'),
  'whale animation module': client.includes('WhaleGirlStage') && client.includes('idle-v4-r2'),
  'whale visible by default': client.includes('dsh-token-monitor-show-whale-girl'),
  'revive transition': client.includes('revive-recharge') && client.includes('previousSnapshot <= 0'),
  'secure package asset routes': host.includes('/assets/dsh-token-monitor/whale-girl')
    && host.includes('/assets/dsh-token-monitor/settings-ui/cute')
    && host.includes('X-Content-Type-Options')
    && host.includes('kind: "prefix"'),
  'settings, budget, and notification routes': host.includes('/api/token-monitor/settings')
    && host.includes('/api/token-monitor/daily-budget')
    && host.includes('/api/token-monitor/notification-events'),
  'wechat connection routes': host.includes('/api/token-monitor/wechat')
    && ['/status', '/login', '/confirm', '/reconnect', '/disconnect', '/test']
      .every(path => host.includes(path)),
  'wechat CLI environment only': host.includes('WECHAT_NOTIFY_CLAWBOT_INDEX')
    && !host.includes('cli-in-wechat-v1')
    && !host.includes('C:\\Users\\'),
  'wechat agent tool registration': ['wechat_notify', 'wechat_login', 'wechat_login_confirm']
    .every((name) => host.includes(`"${name}"`) || host.includes(`'${name}'`)),
  'single child process execution source': childProcessImports.length === 1,
  'all notification defaults disabled': notificationDefaults.every(key =>
    settingsContract.includes(`${key}: false`)
  ) && settingsContract.includes('NOTIFICATION_DEFAULT_OFF_KEYS'),
  'Client connection injection': manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-connection') === true
    && client.includes('ctx.get("connection")'),
  'client inject starts with connection and excludes legacy runtime':
    manifest.dsh?.client?.inject?.indexOf('@deepseek-ai/dsh-client-connection') === 0
    && !manifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-runtime')
    && !client.includes('@deepseek-ai/dsh-client-runtime'),
  'session-row trailing seat + legacy bridge in client bundle':
    sessionRowMarkers.every(marker => client.includes(marker)),
 'client bundle synced from current client source':
   sessionRowMarkers.every(marker => clientSourceText.includes(marker)),
  'peer ranges cover legacy DSH and Desktop 2.0.4':
    Object.entries(manifest.peerDependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
      .every(([, range]) => range.includes('^0.1.0-rc.5')
        && range.includes('^0.1.1-rc.2')
        && range.includes('^0.1.2-alpha.1')),
  'Client WeChat settings': client.includes('wechatNotificationsEnabled')
    && client.includes('/api/token-monitor/wechat')
    && client.includes('/status')
    && client.includes('/test'),
  'complete settings asset set': settingsAssets.length === 29
    && settingsAssets.includes('cute-icon-notification.png')
    && settingsAssets.includes('cute-icon-send-test.png')
    && settingsAssets.includes('cute-decoration-ribbon.png'),
  'runtime whale assets': [
    'idle-v4-r2/idle-01.png',
    'idle-v4-r2/acting-08.png',
    'feedback-expression-v4-r4-model/frames/critical-close.png',
    'feedback-expression-v4-r5-critical-model/frames/critical-overflow.png',
    'revive-recharge-v1/frames/revive-reopen.png',
    'death-stranded-v6-trim.png',
  ].every((path) => existsSync(new URL(`../assets/dsh-token-monitor/whale-girl/` + path, import.meta.url))),
  'package includes assets': manifest.files?.includes('assets/**/*') === true,
}

for (const entry of Object.entries(checks)) {
  const label = entry[0]
  const ok = entry[1]
  console.log((ok ? '[OK] ' : '[FAILED] ') + label)
}
if (Object.values(checks).some(ok => !ok)) process.exitCode = 1
