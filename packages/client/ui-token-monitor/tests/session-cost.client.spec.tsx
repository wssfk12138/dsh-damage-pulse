// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContextLike, SessionId, SessionListStateLike, SessionSummaryLike } from '../src/client/host-contracts.ts'
import { LegacySessionCostBridge } from '../src/client/LegacySessionCostBridge.tsx'
import { SessionCostBadge } from '../src/client/SessionCostBadge.tsx'
import {
  apply,
  inject,
  LegacySessionCostBridge as RegisteredBridge,
  SessionCostBadge as RegisteredBadge,
} from '../src/client/index.ts'
import {
  formatSessionCost,
  readSessionCost,
  SESSION_COST_MARKER,
  SESSION_COST_TITLE,
  SESSION_ROW_TRAILING_SLOT,
} from '../src/client/sessionCost.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

const sid = (id: string) => id as SessionId

function summary(id: string, displayTitle: string, cost?: number): SessionSummaryLike {
  return {
    id: sid(id),
    displayTitle,
    running: false,
    blank: false,
    updatedAt: 0,
    ...(cost === undefined ? {} : { projectionValues: { tokenCost: { cost } } }),
  }
}

function listState(sessions: SessionSummaryLike[]): SessionListStateLike {
  return {
    byId: Object.fromEntries(sessions.map(session => [session.id, session])) as SessionListStateLike['byId'],
    current: undefined,
  }
}

function hookFor(state: SessionListStateLike): SnapshotSelectorHook<SessionListStateLike> {
  return selector => selector(state)
}

/** 全局 kit（useSessions + useWorkspaces），供正式徽标与旧桥组件渲染。 */
function kitFor(state: SessionListStateLike) {
  return {
    useSessions: hookFor(state),
    // 旧桥组件声明了完整 GlobalStandardProps；测试只关心 useSessions。
    useWorkspaces: (() => undefined) as SnapshotSelectorHook<never>,
  }
}

/** 旧版 rc.5/rc.7 会话行 DOM（无 data-session-id、无 trailing marker）。 */
function legacyRowHtml(title: string): string {
  return `<div role="treeitem" aria-selected="false" class="x_sessionRow_1">
    <span class="x_slot_2"></span>
    <span class="x_title_3">${title}</span>
    <span class="x_time_4">刚刚</span>
    <span class="x_rowActions_5"><button aria-label="会话\u201c${title}\u201d的操作">…</button></span>
  </div>`
}

/** 把一行 HTML 挂到 body（返回行元素）。 */
function appendRow(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  const row = host.firstElementChild as HTMLElement
  document.body.appendChild(host)
  return row
}

/** 刷新 MutationObserver 回调队列（jsdom 异步派发）。 */
async function flushMutations(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const bridgeMarker = 'data-dsh-token-monitor-legacy-session-cost'
const sessionIdAttr = 'data-dsh-token-monitor-session-id'
const styleId = 'dsh-token-monitor-legacy-session-cost-style'

function injectedNodes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${bridgeMarker}]`))
}

describe('sessionCost helpers', () => {
  it('reads only positive finite costs from the tokenCost projection', () => {
    expect(readSessionCost(undefined)).toBeUndefined()
    expect(readSessionCost({})).toBeUndefined()
    expect(readSessionCost({ tokenCost: {} })).toBeUndefined()
    expect(readSessionCost({ tokenCost: { cost: 0 } })).toBeUndefined()
    expect(readSessionCost({ tokenCost: { cost: -0.5 } })).toBeUndefined()
    expect(readSessionCost({ tokenCost: { cost: Number.NaN } })).toBeUndefined()
    expect(readSessionCost({ tokenCost: { cost: Number.POSITIVE_INFINITY } })).toBeUndefined()
    expect(readSessionCost({ tokenCost: { cost: 0.008 } })).toBe(0.008)
    expect(readSessionCost({ tokenCost: { cost: 38.6 } })).toBe(38.6)
  })

  it('keeps the legacy format contract: four decimals below a cent, two otherwise', () => {
    expect(formatSessionCost(0.008)).toBe('¥0.0080')
    expect(formatSessionCost(0.01)).toBe('¥0.01')
    expect(formatSessionCost(38.6)).toBe('¥38.60')
  })
})

describe('SessionCostBadge (formal seat)', () => {
  it('renders the cost with the unified marker and Chinese title', () => {
    const state = listState([summary('s1', 'One', 0.008)])
    const { container } = render(<SessionCostBadge sessionId={sid('s1')} {...kitFor(state)} />)
    const badge = container.querySelector<HTMLElement>(`[${SESSION_COST_MARKER}]`)
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('¥0.0080')
    expect(badge?.getAttribute('title')).toBe(SESSION_COST_TITLE)
    expect(badge?.getAttribute(SESSION_COST_MARKER)).toBe('')
  })

  it('renders nothing for missing sessions, zero, or non-finite costs', () => {
    const state = listState([
      summary('s-zero', 'Zero', 0),
      summary('s-nan', 'NaN', Number.NaN),
      summary('s-inf', 'Inf', Number.POSITIVE_INFINITY),
    ])
    expect(render(<SessionCostBadge sessionId={sid('missing')} {...kitFor(state)} />).container.childNodes).toHaveLength(0)
    expect(render(<SessionCostBadge sessionId={sid('s-zero')} {...kitFor(state)} />).container.childNodes).toHaveLength(0)
    expect(render(<SessionCostBadge sessionId={sid('s-nan')} {...kitFor(state)} />).container.childNodes).toHaveLength(0)
    expect(render(<SessionCostBadge sessionId={sid('s-inf')} {...kitFor(state)} />).container.childNodes).toHaveLength(0)
  })

  it('reacts to projection changes', () => {
    const view = render(<SessionCostBadge sessionId={sid('s1')} {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
    expect(view.container.textContent).toBe('¥0.0080')
    view.rerender(<SessionCostBadge sessionId={sid('s1')} {...kitFor(listState([summary('s1', 'One', 38.6)]))} />)
    expect(view.container.textContent).toBe('¥38.60')
    view.rerender(<SessionCostBadge sessionId={sid('s1')} {...kitFor(listState([summary('s1', 'One', 0)]))} />)
    expect(view.container.childNodes).toHaveLength(0)
  })
})

describe('client apply wiring (unknown-seat old hosts)', () => {
  function createFakeClientContext(options: { withConversationEvents?: boolean } = {}) {
    const registered: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const injected: Array<{ key: string; callback: () => unknown }> = []
    const slots = {
      inject(key: string, callback: () => unknown) {
        injected.push({ key, callback })
        return () => {}
      },
      register(options: Record<string, unknown>, component: unknown) {
        registered.push({ options, component })
        return () => {}
      },
    }
    const conversationEvents = options.withConversationEvents === false ? undefined : { register: vi.fn() }
    const directoryLoad = vi.fn().mockResolvedValue({
      current: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      routable: true,
    })
    const modelDirectories = { directoryFor: vi.fn(() => ({ load: directoryLoad })) }
    return {
      ctx: {
        get: (name: string) => {
          if (name === 'connection') return { api: { sessions: {} } }
          if (name === 'conversationEvents') return conversationEvents
          if (name === 'modelDirectories') return modelDirectories
          return undefined
        },
        slots,
      } as unknown as ClientContextLike,
      injected,
      registered,
      conversationEvents,
      directoryLoad,
      modelDirectories,
    }
  }

  it('keeps the legacy event registry optional in the activation contract', () => {
    expect(inject).toEqual(['slots', 'connection', 'modelDirectories'])
  })

  it('activates the remaining UI when the new host has no conversationEvents service', () => {
    const { ctx, injected } = createFakeClientContext({ withConversationEvents: false })
    expect(() => apply(ctx)).not.toThrow()
    expect(injected.some(entry => entry.key === 'conversation.chat.node')).toBe(false)
    expect(injected.some(entry => entry.key === 'conversation.composer.dock')).toBe(true)
    expect(injected.filter(entry => entry.key === 'shell.overlay')).toHaveLength(2)
  })

  it('preserves the single-usage node on old hosts that provide conversationEvents', () => {
    const { ctx, injected, conversationEvents } = createFakeClientContext()
    apply(ctx)
    expect(conversationEvents?.register).toHaveBeenCalledTimes(1)
    expect(injected.some(entry => entry.key === 'conversation.chat.node')).toBe(true)
  })

  it('waits for the trailing seat declaration instead of crashing on old hosts', () => {
    const { ctx, injected, registered } = createFakeClientContext()
    apply(ctx)
    const trailing = injected.find(entry => entry.key === SESSION_ROW_TRAILING_SLOT)
    expect(trailing).toBeDefined()
    // 旧宿主未声明该席位：回调被登记但从未执行 → 没有任何该席位注册、不抛错。
    expect(registered.some(entry => entry.options.name === SESSION_ROW_TRAILING_SLOT)).toBe(false)
    // shell.overlay 一直声明：余额卡片与旧桥各自注册。
    const overlay = injected.filter(entry => entry.key === 'shell.overlay')
    expect(overlay).toHaveLength(2)
    overlay.forEach(entry => entry.callback())
    const ids = registered.filter(entry => entry.options.name === 'shell.overlay').map(entry => entry.options.id)
    expect(ids).toContain('token-monitor-balance')
    expect(ids).toContain('token-monitor-legacy-session-cost')
  })

  it('injects a balance route loader backed by the model directory service', async () => {
    const { ctx, injected, registered, modelDirectories } = createFakeClientContext()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      provider: 'deepseek-official',
      models: ['deepseek-v4-pro'],
      updatedAt: 1,
    }), { status: 200 })))
    apply(ctx)
    injected.find(entry => entry.key === 'shell.overlay')?.callback()
    const balance = registered.find(entry => entry.options.id === 'token-monitor-balance')
    const injectedProps = (balance?.options.inject as (() => Record<string, unknown>))()
    const load = injectedProps.loadRouteEligibility as (
      sessionId: SessionId,
      signal: AbortSignal,
    ) => Promise<boolean | undefined>

    await expect(load(sid('directory-session'), new AbortController().signal)).resolves.toBe(true)
    expect(modelDirectories.directoryFor).toHaveBeenCalledWith(sid('directory-session'))
  })

  it('registers the formal badge once the trailing seat is declared', () => {
    const { ctx, injected, registered } = createFakeClientContext()
    apply(ctx)
    const trailing = injected.find(entry => entry.key === SESSION_ROW_TRAILING_SLOT)
    expect(trailing).toBeDefined()
    trailing?.callback()
    const entry = registered.find(item => item.options.name === SESSION_ROW_TRAILING_SLOT)
    expect(entry).toBeDefined()
    expect(entry?.component).toBe(RegisteredBadge)
    // 导出面与内部组件同一引用。
    expect(RegisteredBridge).toBe(LegacySessionCostBridge)
    expect(RegisteredBadge).toBe(SessionCostBadge)
  })
})

describe('LegacySessionCostBridge (old-host fallback)', () => {
  it('injects the amount between title and time on a legacy row', () => {
    appendRow(legacyRowHtml('One'))
    render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)

    const nodes = injectedNodes()
    expect(nodes).toHaveLength(1)
    const node = nodes[0]
    if (node === undefined) throw new Error('missing injected node')
    expect(node.textContent).toBe('¥0.0080')
    expect(node.getAttribute('title')).toBe(SESSION_COST_TITLE)
    expect(node.getAttribute(sessionIdAttr)).toBe('s1')
    const row = (node.parentElement as HTMLElement)
    expect(row.getAttribute('data-session-id')).toBeNull()
    const children = Array.from(row.children).map(child => child.textContent)
    expect(children.indexOf('One')).toBeGreaterThanOrEqual(0)
    expect(children.indexOf('¥0.0080')).toBe(children.indexOf('One') + 1)
    expect(children.indexOf('刚刚')).toBe(children.indexOf('¥0.0080') + 1)
    expect(document.getElementById(styleId)).not.toBeNull()
  })

  it('stays idempotent across DOM churn and index refreshes', async () => {
    appendRow(legacyRowHtml('One'))
    const view = render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
    expect(injectedNodes()).toHaveLength(1)

    // React 重渲染行结构（整个行替换）。
    const replaced = appendRow(legacyRowHtml('One'))
    replaced.remove()
    await flushMutations()
    expect(injectedNodes()).toHaveLength(1)
    expect(injectedNodes()[0]?.textContent).toBe('¥0.0080')

    // 索引刷新（金额变化）后仍只保留一个节点。
    view.rerender(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 38.6)]))} />)
    expect(injectedNodes()).toHaveLength(1)
    expect(injectedNodes()[0]?.textContent).toBe('¥38.60')
  })

  it('refreshes values and drops nodes when the session disappears', () => {
    appendRow(legacyRowHtml('One'))
    const view = render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
    expect(injectedNodes()[0]?.textContent).toBe('¥0.0080')
    view.rerender(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.05)]))} />)
    expect(injectedNodes()[0]?.textContent).toBe('¥0.05')
    view.rerender(<LegacySessionCostBridge {...kitFor(listState([]))} />)
    expect(injectedNodes()).toHaveLength(0)
  })

  it('deactivates on the formal trailing marker and clears prior injections', async () => {
    appendRow(legacyRowHtml('One'))
    render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
    expect(injectedNodes()).toHaveLength(1)

    appendRow(`<div role="treeitem" aria-selected="true" data-session-id="s1" class="y_sessionRow_1">
      <span class="y_title_3">One</span>
      <span data-session-row-trailing-slot=""></span>
      <span class="y_time_4">刚刚</span>
    </div>`)
    await flushMutations()

    expect(injectedNodes()).toHaveLength(0)
    expect(document.getElementById(styleId)).toBeNull()
  })

  it('deactivates when rows carry data-session-id', () => {
    appendRow(`<div role="treeitem" aria-selected="true" data-session-id="s1" class="y_sessionRow_1">
      <span class="y_title_3">One</span>
      <span class="y_time_4">刚刚</span>
    </div>`)
    render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
    expect(injectedNodes()).toHaveLength(0)
    expect(document.getElementById(styleId)).toBeNull()
  })

  it('defers to an existing native or old-patch cost node without double writing', async () => {
    appendRow(`<div role="treeitem" aria-selected="false" class="x_sessionRow_1">
      <span class="x_title_3">One</span>
      <span class="x_cost_3" title="Session cost">¥0.0100</span>
      <span class="x_time_4">刚刚</span>
    </div>`)
    render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
    expect(injectedNodes()).toHaveLength(0)
    expect(document.querySelector('[title="Session cost"]')).not.toBeNull()
    expect(document.getElementById(styleId)).toBeNull()
  })

  it('defers to a native badge carrying the data marker without the bridge marker', () => {
    appendRow(`<div role="treeitem" aria-selected="false" class="x_sessionRow_1">
      <span class="x_title_3">One</span>
      <span data-dsh-token-monitor-session-cost="" title="会话消费金额">¥0.0100</span>
      <span class="x_time_4">刚刚</span>
    </div>`)
    render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
    expect(injectedNodes()).toHaveLength(0)
  })

  it('fails closed on duplicate display titles and warns only once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      appendRow(legacyRowHtml('Shared'))
      appendRow(legacyRowHtml('Shared'))
      const state = listState([
        summary('s1', 'Shared', 0.008),
        summary('s2', 'Shared', 0.05),
      ])
      render(<LegacySessionCostBridge {...kitFor(state)} />)
      expect(injectedNodes()).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)

      // 后续结构性变更也不会重复告警。
      appendRow(legacyRowHtml('Shared'))
      await flushMutations()
      expect(injectedNodes()).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('fails closed when three sessions share one title (never promoted to unique)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      appendRow(legacyRowHtml('Triple'))
      const state = listState([
        summary('s1', 'Triple', 0.008),
        summary('s2', 'Triple', 0.05),
        summary('s3', 'Triple', 0.12),
      ])
      const view = render(<LegacySessionCostBridge {...kitFor(state)} />)
      expect(injectedNodes()).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)

      // 三重重名不会被提升为“唯一”：再触发一次索引刷新仍不注入。
      view.rerender(<LegacySessionCostBridge {...kitFor(listState([
        summary('s1', 'Triple', 0.009),
        summary('s2', 'Triple', 0.05),
        summary('s3', 'Triple', 0.12),
      ]))} />)
      expect(injectedNodes()).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
      view.unmount()
    } finally {
      warn.mockRestore()
    }
  })

  it('skips every DOM row when one title appears on multiple legacy rows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // 同一会话（唯一 displayTitle）在 DOM 中出现两行：hover/虚拟化副本场景。
      appendRow(legacyRowHtml('One'))
      appendRow(legacyRowHtml('One'))
      render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
      expect(injectedNodes()).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
      // 两行都未被改写。
      expect(document.querySelectorAll('div[role="treeitem"][aria-selected]')).toHaveLength(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('removes the earlier injection when a duplicate DOM row arrives later', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      appendRow(legacyRowHtml('One'))
      const view = render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
      expect(injectedNodes()).toHaveLength(1)

      // 注入后动态新增同标题 DOM 副本：整组重验证应移除旧节点且不注入新节点。
      appendRow(legacyRowHtml('One'))
      await flushMutations()
      expect(injectedNodes()).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
      view.unmount()
    } finally {
      warn.mockRestore()
    }
  })

  it('cleans up injected nodes when the title turns ambiguous in the index', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      appendRow(legacyRowHtml('One'))
      const view = render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
      expect(injectedNodes()).toHaveLength(1)

      // 唯一 → 重名：既有节点必须按整组重验证移除，不再注入。
      view.rerender(<LegacySessionCostBridge {...kitFor(listState([
        summary('s1', 'One', 0.008),
        summary('s2', 'One', 0.05),
      ]))} />)
      expect(injectedNodes()).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
      view.unmount()
    } finally {
      warn.mockRestore()
    }
  })

  it('follows title character updates and virtualization reuse', async () => {
    appendRow(legacyRowHtml('One'))
    const view = render(<LegacySessionCostBridge {...kitFor(listState([
      summary('s1', 'One', 0.008),
      summary('s2', 'Two', 0.05),
    ]))} />)
    expect(injectedNodes()[0]?.textContent).toBe('¥0.0080')
    expect(injectedNodes()[0]?.getAttribute(sessionIdAttr)).toBe('s1')

    // 标题字符更新：行文本改为另一个唯一标题 → 旧节点移除并按新会话补注。
    const titleSpan = document.querySelector<HTMLElement>('.x_title_3')
    if (titleSpan === null) throw new Error('missing legacy title span')
    act(() => { titleSpan.textContent = 'Two' })
    await flushMutations()
    const nodes = injectedNodes()
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.textContent).toBe('¥0.05')
    expect(nodes[0]?.getAttribute(sessionIdAttr)).toBe('s2')

    // 虚拟化重用：同一 DOM 标题重新归属另一会话（索引映射变化）。
    view.rerender(<LegacySessionCostBridge {...kitFor(listState([
      summary('s3', 'Two', 0.12),
      summary('s1', 'One', 0.008),
    ]))} />)
    const reused = injectedNodes()
    expect(reused).toHaveLength(1)
    expect(reused[0]?.textContent).toBe('¥0.12')
    expect(reused[0]?.getAttribute(sessionIdAttr)).toBe('s3')
    view.unmount()
  })

  it('ignores same-title helper structures without treeitem/aria-selected', () => {
    const row = appendRow(legacyRowHtml('One'))
    // hover 卡片式辅助结构：同一标题文本，但不是 treeitem 行。
    appendRow(`<div class="x_hover_card"><span>One</span></div>`)
    render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
    const nodes = injectedNodes()
    expect(nodes).toHaveLength(1)
    expect(row.querySelector(`[${bridgeMarker}]`)).not.toBeNull()
    expect(document.querySelector('.x_hover_card span')?.textContent).toBe('One')
  })

  it('fails closed when the title node is not a direct child of the row', () => {
    appendRow(`<div role="treeitem" aria-selected="false" class="x_sessionRow_1">
      <span class="x_wrapper"><span class="x_title_3">One</span></span>
      <span class="x_time_4">刚刚</span>
    </div>`)
    render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
    expect(injectedNodes()).toHaveLength(0)
  })

  it('fails closed when no time anchor follows the title (blank-like rows)', () => {
    appendRow(`<div role="treeitem" aria-selected="false" class="x_sessionRow_1">
      <span class="x_title_3">One</span>
    </div>`)
    render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
    expect(injectedNodes()).toHaveLength(0)
    expect(document.getElementById(styleId)).toBeNull()
  })

  it('cleans up observer, injected nodes, and styles on unmount', async () => {
    appendRow(legacyRowHtml('One'))
    const view = render(<LegacySessionCostBridge {...kitFor(listState([summary('s1', 'One', 0.008)]))} />)
    expect(injectedNodes()).toHaveLength(1)
    expect(document.getElementById(styleId)).not.toBeNull()

    view.unmount()
    expect(injectedNodes()).toHaveLength(0)
    expect(document.getElementById(styleId)).toBeNull()

    // 卸载后即使 DOM 再变化也不再注入。
    appendRow(legacyRowHtml('One'))
    await flushMutations()
    expect(injectedNodes()).toHaveLength(0)
  })
})
