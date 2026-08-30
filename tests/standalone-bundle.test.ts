import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'

const clientBundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// 标准包侧边栏会话金额能力必须同时满足：
// 1) 新宿主正式席位 sidebar.workspaces.sessionRow.trailing 已注册进产物；
// 2) 旧客户端的 fail-closed 兼容桥及其停用条件（data-session-row-trailing-slot /
//    data-session-id / 既有金额标题）已进入产物。
const bundleMarkers = [
  'sidebar.workspaces.sessionRow.trailing',
  'data-session-row-trailing-slot',
  '会话消费金额',
  'aria-selected',
]

// Issue 排查后 README 不得再保留的旧结论。
const staleReadmePhrases = [
  '标准包本身不会修改宿主 DOM',
  '以输入区会话累计条为准',
]

test('README no longer carries stale standard-package claims', () => {
  for (const phrase of staleReadmePhrases) {
    assert.ok(!readme.includes(phrase), `README must not claim: ${phrase}`)
  }
})

test('README documents the new standard-package session-row capability', () => {
  for (const phrase of ['sidebar.workspaces.sessionRow.trailing', 'fail-closed', '兼容桥']) {
    assert.ok(readme.includes(phrase), `README must mention: ${phrase}`)
  }
})

test('standalone client bundle carries the formal trailing seat and legacy bridge', () => {
  // 若缺失，说明 lib/client.js 是旧构建产物：请用当前源码重新执行 pnpm build。
  for (const marker of bundleMarkers) {
    assert.ok(clientBundle.includes(marker), `lib/client.js is missing ${marker}; rebuild the client bundle from current source`)
  }
})

test('standalone package keeps every packed file for precompiled installs (issue #1)', () => {
  // 回归 #1：仓库曾经只有源码集成目录、无根级 bundle manifest/预编译产物，导致
  // bundled DSH 的市场安装直接失败。现在标准包必须自带这些文件，禁止退回纯源码形态。
  for (const file of ['lib/index.js', 'lib/client.js', 'lib/client.js.map', 'cordis.patch.yml', 'tsconfig.bundle.json', 'README.md', 'LICENSE']) {
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `packed file missing: ${file}`)
  }
  assert.ok(existsSync(new URL('../assets/dsh-token-monitor/', import.meta.url)), 'packed assets directory is missing')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  const inject: string[] = manifest.dsh?.client?.inject ?? []
  for (const pkg of [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-layout',
  ]) {
    assert.ok(inject.includes(pkg), `dsh.client.inject is missing ${pkg}`)
    assert.ok(manifest.peerDependencies?.[pkg], `injected client package ${pkg} must be declared as a peer`)
  }
  assert.ok(!inject.includes('@deepseek-ai/dsh-client-runtime'), 'Desktop 2.0.4 cannot resolve legacy runtime injection')
  assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh-client-runtime'], undefined)
  assert.ok(!clientBundle.includes('@deepseek-ai/dsh-client-runtime'), 'client bundle must not require the legacy runtime')
})

test('README install claim covers both DSH generations (issues #3 and #10)', () => {
  // #3 要求 0.1.1-rc.2（stateSchema/wire）；#10 要求 0.1.0-rc.8 这类旧宿主机
  // 也能安装（schema/view）。README 不得再只写 “0.1.1-rc.2 或更高”，否则会重演
  // peer 与实机版本不一致的安装失败。
  assert.ok(readme.includes('0.1.0-rc.5'), 'README must mention the 0.1.0-rc.5 compatibility leg')
  assert.ok(readme.includes('0.1.1-rc.2'), 'README must mention 0.1.1-rc.2 compatibility')
  assert.ok(readme.includes('0.1.2-alpha.1'), 'README must mention DSH Desktop 2.0.4 compatibility')
  assert.ok(!readme.includes('0.1.1-rc.2` 或更高兼容版本'), 'README must not claim rc.2-or-higher only')
})
