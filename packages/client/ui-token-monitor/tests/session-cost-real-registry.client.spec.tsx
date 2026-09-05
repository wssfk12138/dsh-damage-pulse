// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'

// 真实运行时回归：用 @deepseek-ai/dsh-client-runtime 的模块加载器 bundle + 真实
// SlotRegistry 验证标准包 client 对 sessionRow.trailing 的注入语义：
// 1) 旧宿主未声明尾席时 pending、不崩溃；2) 后声明时补注册正式徽标；
// 3) 卸载时全量清除；4) 正式席位与 LegacySessionCostBridge 不双写。

const TRAILING = 'sidebar.workspaces.sessionRow.trailing'
const OVERLAY = 'shell.overlay'
const NODE = 'conversation.chat.node'
const DOCK = 'conversation.composer.dock'

// vitest 的 jsdom 环境里 import.meta.url 不是 file scheme，统一以仓库根（vitest 工作目录）定位。
const PLUGIN_BUNDLE_PATH = join(process.cwd(), 'lib/client.js')
const RUNTIME_BUNDLE_PATH = join(process.cwd(), 'node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js')

type BundleFactory = (requireShim: (id: string) => unknown) => Record<string, unknown>

function loadModuleLoaderBundles(): { runtime: BundleFactory; plugin: BundleFactory } {
  const registered = new Map<string, BundleFactory>()
  const windowWithLoader = window as unknown as {
    __ModuleLoader__: { load: (entry: { id: string; factory: BundleFactory }) => void }
  }
  windowWithLoader.__ModuleLoader__ = {
    load: (entry) => {
      registered.set(entry.id, entry.factory)
    },
  }
  // 两个 bundle 的顶层只调用 window.__ModuleLoader__.load(...)，可安全在 jsdom 中求值。
  new Function(readFileSync(PLUGIN_BUNDLE_PATH, 'utf8'))()
  new Function(readFileSync(RUNTIME_BUNDLE_PATH, 'utf8'))()
  return {
    runtime: registered.get('@deepseek-ai/dsh-client-runtime') as BundleFactory,
    plugin: registered.get('dsh-damage-pulse') as BundleFactory,
  }
}

type Registry = {
  inject(key: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
  entries(key: string): Array<{ options: Record<string, unknown>; component: unknown }>
  entriesOfSlot(key: string): Array<{ options: Record<string, unknown>; component: unknown }>
  spec(key: string): unknown
}

interface HostHandle {
  ctx: Context
  slots: Registry
  pluginFiber: { dispose(): Promise<unknown> }
  layout: { dispose(): Promise<unknown> }
  collect(): { overlayIds: string[]; nodeKeys: string[]; dockIds: string[]; trailingCount: number }
  teardown(): Promise<void>
  upgradeTrailing(): Promise<{ dispose(): Promise<unknown> }>
}

const { runtime: runtimeFactory, plugin: pluginFactory } = loadModuleLoaderBundles()
const nativeRequire = createRequire(import.meta.url)
const requireShim = (id: string): unknown => {
  if (id === 'react') return nativeRequire('react')
  if (id === 'react/jsx-runtime') return nativeRequire('react/jsx-runtime')
  if (id === '@deepseek-ai/cordis') return nativeRequire('@deepseek-ai/cordis')
  if (id === '@deepseek-ai/dsh-client-ui-slots') return nativeRequire('@deepseek-ai/dsh-client-ui-slots')
  throw new Error('unexpected module-loader require: ' + id)
}
const runtimeMod = runtimeFactory(requireShim)
const pluginMod = pluginFactory(requireShim)
const { SlotRegistry } = runtimeMod as unknown as { SlotRegistry: new (ctx: Context) => unknown }

function layoutChildren(withTrailing: boolean): Record<string, { kind: string; scope: string }> {
  const children: Record<string, { kind: string; scope: string }> = {
    [OVERLAY]: { kind: 'list', scope: 'root' },
    [NODE]: { kind: 'keyed', scope: 'session' },
    [DOCK]: { kind: 'list', scope: 'session' },
  }
  if (withTrailing) children[TRAILING] = { kind: 'single', scope: 'session' }
  return children
}

async function bootHost(withTrailing: boolean): Promise<HostHandle> {
  const ctx = new Context()
  let slots: Registry | undefined
  const fibers: Array<{ dispose(): Promise<unknown> }> = []

  const setup = ctx.plugin((inner: Context) => {
    slots = new SlotRegistry(inner) as Registry
    inner.provide('connection', { api: { sessions: {} } })
    inner.provide('modelDirectories', { directoryFor: () => ({ load: async () => ({ current: null, routable: [] }) }) })
    inner.provide('conversationEvents', { register: () => {} })
  })
  await setup
  fibers.push(setup)

  const layout = ctx.plugin({
    inject: ['slots'],
    apply: (inner: Context) => {
      ;(inner as unknown as { slots: Registry }).slots.register(
        { name: 'root', children: layoutChildren(withTrailing) },
        () => null,
      )
    },
  })
  await layout
  fibers.push(layout)

  const pluginFiber = ctx.plugin({
    name: 'dsh-token-monitor',
    inject: pluginMod.inject as string[],
    apply: pluginMod.apply as (ctx: Context) => void,
  })
  await pluginFiber
  fibers.push(pluginFiber)
  await new Promise((resolve) => setTimeout(resolve, 10))

  const registry = slots as Registry
  const collect = () => ({
    overlayIds: registry.entriesOfSlot(OVERLAY).map((entry) => String(entry.options.id)),
    nodeKeys: registry.entriesOfSlot(NODE).map((entry) => String(entry.options.key)),
    dockIds: registry.entriesOfSlot(DOCK).map((entry) => String(entry.options.id)),
    trailingCount: registry.entries(TRAILING).length,
  })

  const upgradeTrailing = () =>
    ctx.plugin({
      inject: ['slots'],
      apply: (inner: Context) => {
        ;(inner as unknown as { slots: Registry }).slots.register(
          { name: 'root', priority: -1, children: { [TRAILING]: { kind: 'single', scope: 'session' } } },
          () => null,
        )
      },
    })

  return {
    ctx,
    slots: registry,
    pluginFiber,
    layout,
    collect,
    upgradeTrailing,
    teardown: async () => {
      for (const fiber of [...fibers].reverse()) await fiber.dispose()
    },
  }
}

describe('built client bundle against the real SlotRegistry', () => {
  it('stays pending on an old host and supplements the badge after a later trailing declaration', async () => {
    const host = await bootHost(false)
    try {
      expect(host.slots.spec(TRAILING)).toBeUndefined()
      expect(host.collect()).toEqual({
        overlayIds: ['token-monitor-balance', 'token-monitor-legacy-session-cost'],
        nodeKeys: ['token-usage'],
        dockIds: ['token-monitor-stats'],
        trailingCount: 0,
      })

      const upgrade = await host.upgradeTrailing()
      await new Promise((resolve) => setTimeout(resolve, 10))
      const trailingEntries = host.slots.entries(TRAILING)
      expect(trailingEntries).toHaveLength(1)
      expect(typeof trailingEntries[0]!.component).toBe('function')
      // 正式席位补注册后 overlay 不被改动：余额卡 + 旧桥各一份，无双写。
      expect(host.collect().overlayIds).toEqual(['token-monitor-balance', 'token-monitor-legacy-session-cost'])

      await upgrade.dispose()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(host.slots.entries(TRAILING)).toHaveLength(0)
    } finally {
      await host.teardown()
    }
  })

  it('registers the formal badge immediately when the trailing seat is predeclared', async () => {
    const host = await bootHost(true)
    try {
      expect(host.slots.entries(TRAILING)).toHaveLength(1)
      expect(typeof host.slots.entries(TRAILING)[0]!.component).toBe('function')
      expect(host.collect().overlayIds).toEqual(['token-monitor-balance', 'token-monitor-legacy-session-cost'])
    } finally {
      await host.teardown()
    }
  })

  it('removes every contribution on unload (overlay/node/dock and trailing)', async () => {
    const host = await bootHost(true)
    expect(host.collect()).toEqual({
      overlayIds: ['token-monitor-balance', 'token-monitor-legacy-session-cost'],
      nodeKeys: ['token-usage'],
      dockIds: ['token-monitor-stats'],
      trailingCount: 1,
    })
    await host.pluginFiber.dispose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(host.collect().overlayIds).toEqual([])
    expect(host.collect().nodeKeys).toEqual([])
    expect(host.collect().dockIds).toEqual([])
    // trailing 由布局声明持有，布局卸载后随声明塌缩清空。
    await host.layout.dispose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(host.slots.entries(TRAILING)).toHaveLength(0)
  })
})
