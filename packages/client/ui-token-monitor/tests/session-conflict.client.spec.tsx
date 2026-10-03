// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenCostProjection } from '../src/client/types.ts'
import type { SessionId } from '../src/client/host-contracts.ts'
import { SessionCostBadge } from '../src/client/SessionCostBadge.tsx'
import { SessionStatsBar } from '../src/client/SessionStatsBar.tsx'
import { LegacySessionCostBridge } from '../src/client/LegacySessionCostBridge.tsx'
import { en } from '../src/client/detail-locales.ts'
import { indexLedgerSessions, ledgerSessionEntry, loadSessionLedger, resolveSessionCost, type LedgerSessionSummary } from '../src/client/sessionLedger.ts'

const conflict = { id: 'a', sessionId: 'a', status: 'conflict' as const, cost: null, lastActivity: 3,
  conflicts: [{ normalizedId: 'a', rawSessionIds: ['a', 'session-a'], reasons: ['normalized-id-collision' as const] }] }
const priced: LedgerSessionSummary = { id: 'a', cost: 2, calls: 1, inputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 3, totalTokens: 5, lastActivity: 3 }
const sessionId = 'session-a' as SessionId
const projection: TokenCostProjection = { cost: 9, calls: 1, totalTokens: 5, inputTokens: 2, outputTokens: 3,
  cacheReadTokens: 0, cacheWriteTokens: 0, lastActivity: 3 }
const state: SessionListState = { ids: [sessionId], phase: 'ready', projectionsBySession: {},
  byId: { [sessionId]: { id: sessionId, displayTitle: 'One', running: false, blank: false, updatedAt: 3,
    retainedBy: {}, projectionValues: { tokenCost: projection } } } }
const useSessions: GlobalStandardProps['useSessions'] = selector => selector(state)
const t: NonNullable<ComponentProps<typeof SessionCostBadge>['t']> = key => en[key]
// Unrelated slot hooks/actions are fully typed and fail loudly if accidentally consumed.
const unused = () => { throw new Error('Unrelated slot hook called') }
const kit = { useSessions, usePanelInfo: unused, useResource: unused, useWorkspaces: unused,
  useSessionPendingInteraction: unused, useSessionStatus: unused, useSessionRetainInfo: unused,
  useSession: unused, useConversation: unused, useInput: unused, useChat: unused,
  inputActions: { captureInsertion: unused, insertText: unused, setDraft: unused, addAttachments: unused,
    removeAttachment: unused, pruneAttachments: unused, submit: unused } }
function statsProps(value: TokenCostProjection | undefined): ComponentProps<typeof SessionStatsBar> {
  // Only tokenCost is requested here; this test adapter does not implement unrelated generic projection keys.
  const useProjection = (() => value) as ComponentProps<typeof SessionStatsBar>['useProjection']
  return { ...kit, sessionId, useProjection, t }
}
function bridgeProps(): ComponentProps<typeof LegacySessionCostBridge> {
  return { ...kit, t }
}
function fetchRows(rows: readonly object[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sessions: rows }))))
}
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.unstubAllGlobals() })

describe('session identity conflict display', () => {
  it('keeps conflict lookup and suppresses any positive projection', async () => {
    fetchRows([conflict])
    const map = await loadSessionLedger({ force: true })
    const entry = ledgerSessionEntry(map, sessionId)
    expect(entry).toEqual(conflict)
    expect(resolveSessionCost(9, entry)).toMatchObject({ status: 'conflict', cost: null })
    expect(resolveSessionCost(undefined, entry)).toMatchObject({ status: 'conflict', cost: null })
  })
  it('does not last-win alias rows, even when one alias is zero', () => {
    for (const rows of [[priced, { ...priced, id: 'session-a', cost: 0 }], [{ ...priced, id: 'session-a', cost: 0 }, priced]]) {
      expect(ledgerSessionEntry(indexLedgerSessions(rows), sessionId)).toMatchObject({ status: 'conflict', cost: null })
    }
  })
  it('retains a successful conflict snapshot on malformed wire data and recovers on a valid refresh', async () => {
    fetchRows([conflict]); const first = await loadSessionLedger({ force: true })
    for (const bad of [{ ...conflict, cost: 0 }, { ...conflict, calls: 0 }, { ...conflict, conflicts: [] }, { ...conflict, conflicts: [{ normalizedId: 'a', rawSessionIds: ['a'], reasons: ['future'] }] }, { ...priced, status: 'future' }, { ...priced, calls: '1' }, { ...priced, sessionId: 'different' }]) {
      fetchRows([bad]); expect(await loadSessionLedger({ force: true })).toBe(first)
    }
    fetchRows([priced]); const recovered = await loadSessionLedger({ force: true })
    expect(ledgerSessionEntry(recovered, sessionId)?.cost).toBe(2)
    fetchRows([]); const empty = await loadSessionLedger({ force: true })
    expect(empty.size).toBe(0)
    expect(resolveSessionCost(0, ledgerSessionEntry(empty, sessionId))).toEqual({ cost: 0, fromLedger: false })
  })
  it('updates badge and stats through numeric / conflict / numeric and hides untrusted counters', async () => {
    fetchRows([priced]); await loadSessionLedger({ force: true })
    const view = render(<>
      <SessionCostBadge sessionId={sessionId} useSessions={useSessions} t={t} /><SessionStatsBar {...statsProps(projection)} />
    </>)
    expect(view.container.textContent).toContain('¥9')
    fetchRows([conflict]); await act(async () => { await loadSessionLedger({ force: true }) })
    expect(view.container.textContent).not.toContain('¥')
    expect(view.container.textContent).not.toContain('tokens')
    expect(view.container.querySelectorAll('[data-dsh-token-monitor-cost-source="conflict"], [data-dsh-token-monitor-stats-source="conflict"]')).toHaveLength(2)
    expect(view.container.textContent).toContain(en.sessionIdentityConflict)
    view.rerender(<SessionStatsBar {...statsProps(undefined)} />)
    expect(view.container.textContent).toContain(en.sessionIdentityConflict)
    fetchRows([priced]); await act(async () => { await loadSessionLedger({ force: true }) })
    view.rerender(<SessionStatsBar {...statsProps(projection)} />)
    expect(view.container.textContent).toContain('¥9')
  })
  it('updates the old-host bridge and removes it when modern host capability appears', async () => {
    document.body.innerHTML = '<div role="treeitem" aria-selected="false"><span>One</span><span>Now</span></div>'
    fetchRows([priced]); await loadSessionLedger({ force: true })
    render(<LegacySessionCostBridge {...bridgeProps()} />)
    const node = () => document.querySelector('[data-dsh-token-monitor-legacy-session-cost]')
    expect(node()?.textContent).toContain('¥9')
    fetchRows([conflict]); await act(async () => { await loadSessionLedger({ force: true }) })
    expect(node()?.textContent).toBe(en.sessionIdentityConflict)
    expect(node()?.getAttribute('data-dsh-token-monitor-cost-source')).toBe('conflict')
    fetchRows([priced]); await act(async () => { await loadSessionLedger({ force: true }) })
    expect(node()?.textContent).toContain('¥9')
    expect(node()?.getAttribute('data-dsh-token-monitor-cost-source')).toBeNull()
    await act(async () => { document.querySelector('[role="treeitem"]')?.setAttribute('data-session-id', 'a') })
    expect(node()).toBeNull()
  })
})
