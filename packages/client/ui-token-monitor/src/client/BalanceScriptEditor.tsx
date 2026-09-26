import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DetailTranslate } from './detail-locales.ts'
import css from './BillingRulesPanel.module.css'

type Endpoint = { path: string; method: string }
type Snapshot = {
  provider: string
  revision: number
  script: string
  status: 'unconfigured' | 'valid' | 'invalid' | 'unapproved'
  error?: string
  request?: Endpoint
  /** Set when the Host shipped the adapter for this provider's endpoint. */
  source?: 'built-in'
  /** Vendor label of that shipped adapter. */
  adapter?: string
}
type Draft = { snapshot?: Snapshot; text: string; version: number; dirty: boolean; pending: boolean; error?: 'load' | 'save' | 'conflict' | 'approve' }

function readEndpoint(value: unknown): Endpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const endpoint = value as Endpoint
  return typeof endpoint.path === 'string' && typeof endpoint.method === 'string'
    ? { path: endpoint.path, method: endpoint.method }
    : undefined
}

function readSnapshot(value: unknown, provider: string): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid script response')
  const result = value as Snapshot
  if (result.provider !== provider || !Number.isSafeInteger(result.revision) || result.revision < 0
    || typeof result.script !== 'string' || !['unconfigured', 'valid', 'invalid', 'unapproved'].includes(result.status)) throw new Error('Invalid script response')
  const request = readEndpoint(result.request)
  return { ...result, ...(request === undefined ? {} : { request }) }
}

/** Provider-owned drafts survive model/provider navigation and serialize their own writes. */
export function BalanceScriptEditor({ provider, t, onBusyChange }: {
  provider: string
  t: DetailTranslate
  onBusyChange: (busy: boolean) => void
}) {
  const drafts = useRef(new Map<string, Draft>())
  const [tick, redraw] = useState(0)
  const mounted = useRef(true)
  const refresh = () => { if (mounted.current) redraw(value => value + 1) }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const load = async (id: string) => {
    const draft: Draft = { text: '', version: 0, dirty: false, pending: true }
    drafts.current.set(id, draft); refresh()
    try {
      const response = await fetch('/api/token-monitor/balance-script?provider=' + encodeURIComponent(id))
      if (!response.ok) throw new Error('Script load failed')
      draft.snapshot = readSnapshot(await response.json(), id)
      draft.text = draft.snapshot.script
    } catch { draft.error = 'load' }
    finally { draft.pending = false; refresh() }
  }
  useEffect(() => { if (provider && !drafts.current.has(provider)) void load(provider) }, [provider])
  const save = async (id: string, draft: Draft) => {
    if (!draft.snapshot || draft.pending) return
    draft.pending = true; delete draft.error
    const version = draft.version, script = draft.text
    refresh()
    try {
      const response = await fetch('/api/token-monitor/balance-script?provider=' + encodeURIComponent(id), {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: draft.snapshot.revision, script }),
      })
      if (!response.ok) { draft.error = response.status === 409 ? 'conflict' : 'save'; return }
      draft.snapshot = readSnapshot(await response.json(), id)
      if (version === draft.version) draft.dirty = false
    } catch { draft.error = 'save' }
    finally { draft.pending = false; refresh() }
  }
  // Approving never edits the script: it only lets this exact path and method run.
  const approve = async (id: string, draft: Draft) => {
    const endpoint = draft.snapshot?.request
    if (endpoint === undefined || draft.pending) return
    draft.pending = true; delete draft.error
    refresh()
    try {
      const response = await fetch('/api/token-monitor/balance-endpoint?provider=' + encodeURIComponent(id), {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: endpoint.path, method: endpoint.method }),
      })
      if (!response.ok) { draft.error = 'approve'; return }
      draft.snapshot = readSnapshot(await response.json(), id)
    } catch { draft.error = 'approve' }
    finally { draft.pending = false; refresh() }
  }
  useEffect(() => {
    onBusyChange([...drafts.current.values()].some(draft => draft.dirty || draft.pending))
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const [id, draft] of drafts.current) {
      if (draft.dirty && !draft.pending && !draft.error) timers.push(setTimeout(() => { void save(id, draft) }, 500))
    }
    return () => { for (const timer of timers) clearTimeout(timer) }
  }, [tick, onBusyChange])
  if (!provider) return <p>{t('balanceSelectProvider')}</p>
  const draft = drafts.current.get(provider)
  if (!draft) return <p>{t('loading')}</p>
  return <section className={css.stack} aria-label={t('balanceScriptTab')}>
    <h3>{provider}</h3>
    <p role="status">{draft.pending ? t(draft.snapshot ? 'billingSaving' : 'loading') : draft.dirty ? t('balancePending') : draft.snapshot ? t('balanceSaved') : ''}</p>
    {draft.snapshot && <>
      <label htmlFor="token-monitor-balance-script">{t('balanceScriptLabel')}</label>
      <textarea id="token-monitor-balance-script" className={css.scriptEditor} spellCheck={false}
        value={draft.text} placeholder={t('balanceUnconfigured')}
        onChange={(event) => { draft.text = event.target.value; draft.version++; draft.dirty = true; if (draft.error !== 'conflict') delete draft.error; refresh() }} />
      {!draft.dirty && <p role={draft.snapshot.status === 'invalid' ? 'alert' : 'status'}>
        {t(draft.snapshot.status === 'valid' ? 'balanceValid' : draft.snapshot.status === 'invalid' ? 'balanceInvalid' : draft.snapshot.status === 'unapproved' ? 'balanceUnapproved' : 'balanceUnconfigured')}
        {draft.snapshot.source === 'built-in' && <><br />{t('balanceBuiltIn')}{draft.snapshot.adapter === undefined ? '' : '：' + draft.snapshot.adapter}</>}
        {draft.snapshot.status === 'invalid' && draft.snapshot.error && <><br />{draft.snapshot.error}</>}
        {draft.snapshot.status === 'unapproved' && draft.snapshot.request && <><br />{t('balanceEndpointLabel')}：{draft.snapshot.request.method + ' ' + draft.snapshot.request.path}</>}
      </p>}
      {!draft.dirty && draft.snapshot.status === 'unapproved' && <Button onClick={() => { void approve(provider, draft) }}>{t('balanceApprove')}</Button>}
    </>}
    {draft.error && <div role="alert">
      {t(draft.error === 'conflict' ? 'balanceConflict' : draft.error === 'load' ? 'balanceLoadFailed' : draft.error === 'approve' ? 'balanceApproveFailed' : 'billingSaveFailed')}
      {draft.error === 'conflict'
        ? <Button onClick={() => { void load(provider) }}>{t('billingLoadLatest')}</Button>
        : <><Button onClick={() => { if (draft.error === 'load') void load(provider); else if (draft.error === 'approve') void approve(provider, draft); else void save(provider, draft) }}>{t('balanceRetry')}</Button>
          {draft.error === 'save' && <Button onClick={() => { void load(provider) }}>{t('billingLoadLatest')}</Button>}</>}
    </div>}
  </section>
}
