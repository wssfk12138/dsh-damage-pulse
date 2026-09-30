import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  TOKEN_MONITOR_ASSET_BASE,
  TOKEN_MONITOR_CUTE_ASSET_BASE,
  TOKEN_MONITOR_WHALE_ASSET_BASE,
} from '@deepseek-ai/dsh-token-monitor-contract'
import { TOKEN_MONITOR_ASSET_ROUTES } from '../plugins/dsh-token-monitor/src/assets.ts'

// 回归 #25：桌面外壳自己接管全部 /assets/** 请求，从自带的冻结前端产物里出图。
// 插件资源挂在该前缀下永远到不了宿主，浏览器只会拿到 404 — 鲸鱼娘整张画布空白、
// 设置图标全裂。资源 URL 必须落在插件自有的文档相对命名空间，且宿主路由与客户端
// 图片地址共用契约里的同一份常量，避免任何一侧再被改回旧前缀。
const RETIRED_PREFIX = '/assets/dsh-token-monitor'
// 只针对「以引号开头、直接写在代码里的 URL」，不误伤 assets.ts 里那段
// '../../../assets/dsh-token-monitor/' 磁盘目录定位。
const RETIRED_URL_LITERAL = /['"`]\/assets\/dsh-token-monitor/
const CLIENT_SOURCES = [
  'BalanceWidget.tsx',
  'WhaleGirlStage.tsx',
  'ModuleManagerPanel.tsx',
  'TokenMonitorSettingsPanel.tsx',
]
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const readClient = (name: string) => read(`../packages/client/ui-token-monitor/src/client/${name}`)

test('asset URL constants stay outside the shell-owned /assets namespace', () => {
  assert.equal(TOKEN_MONITOR_ASSET_BASE, '/token-monitor-assets')
  assert.equal(TOKEN_MONITOR_WHALE_ASSET_BASE, `${TOKEN_MONITOR_ASSET_BASE}/whale-girl`)
  assert.equal(TOKEN_MONITOR_CUTE_ASSET_BASE, `${TOKEN_MONITOR_ASSET_BASE}/settings-ui/cute`)
  for (const base of [TOKEN_MONITOR_ASSET_BASE, TOKEN_MONITOR_WHALE_ASSET_BASE, TOKEN_MONITOR_CUTE_ASSET_BASE]) {
    assert.ok(base.startsWith('/'), `${base} must be an absolute browser path`)
    assert.ok(!base.startsWith('/assets/'), `${base} must not sit under the shell-owned /assets prefix`)
    assert.ok(!base.startsWith(RETIRED_PREFIX), `${base} must not reuse the retired asset prefix`)
  }
})

test('host asset routes derive from the contract constants', () => {
  assert.deepEqual(
    TOKEN_MONITOR_ASSET_ROUTES.map(route => route.path),
    [TOKEN_MONITOR_WHALE_ASSET_BASE, TOKEN_MONITOR_CUTE_ASSET_BASE],
  )
  const assets = read('../plugins/dsh-token-monitor/src/assets.ts')
  assert.ok(!RETIRED_URL_LITERAL.test(assets), 'assets.ts must not hardcode the retired asset URL prefix')
  const runtimeHost = read('../plugins/dsh-token-monitor/src/runtime-host.ts')
  assert.ok(runtimeHost.includes('${TOKEN_MONITOR_ASSET_BASE}/${directory}'), 'runtime-host.ts must derive its route from the contract constant')
  assert.ok(!RETIRED_URL_LITERAL.test(runtimeHost), 'runtime-host.ts must not hardcode the retired asset URL prefix')
})

test('client image URLs derive from the contract constants', () => {
  for (const name of CLIENT_SOURCES) {
    assert.ok(!RETIRED_URL_LITERAL.test(readClient(name)), `${name} must not hardcode the retired asset URL prefix`)
  }
  for (const name of ['BalanceWidget.tsx', 'WhaleGirlStage.tsx']) {
    assert.ok(readClient(name).includes('TOKEN_MONITOR_WHALE_ASSET_BASE'), `${name} must derive whale assets from the contract constant`)
  }
  for (const name of ['ModuleManagerPanel.tsx', 'TokenMonitorSettingsPanel.tsx']) {
    assert.ok(readClient(name).includes('TOKEN_MONITOR_CUTE_ASSET_BASE'), `${name} must derive cute icons from the contract constant`)
  }
})

test('shipped client bundle requests assets from the plugin namespace (issue #25)', () => {
  const bundle = read('../lib/client.js')
  // 打包器可能把鲸鱼娘/图标的拼接收紧成对基础常量的延迟拼接，所以核对基础常量本身。
  assert.ok(bundle.includes(TOKEN_MONITOR_ASSET_BASE), 'lib/client.js must request assets from the plugin namespace; rebuild the client bundle from current source')
  assert.ok(!bundle.includes(RETIRED_PREFIX), 'lib/client.js still carries the retired asset prefix; rebuild the client bundle from current source')
})
