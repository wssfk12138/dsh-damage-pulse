import { useId, useRef, useState, useEffect } from 'react'
import type { ModuleRestorePlan, ModuleSnapshot, ModuleUpdateStatus } from '@deepseek-ai/dsh-token-monitor-contract'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DetailKey, DetailTranslate } from './detail-locales.ts'
import { moduleApi } from './moduleApi.ts'
import { ManagerCommunityIcon } from './ModuleManagerIcons.tsx'
import css from './ModuleManagerPanel.module.css'

const asset = (name: string) => `/assets/dsh-token-monitor/settings-ui/cute/${name}.png`
const labels: Record<string, [DetailKey, DetailKey, string]> = {
  pet: ['modulesPet', 'modulesPetDescription', 'warning'],
  overview: ['modulesOverview', 'modulesOverviewDescription', 'warning'],
  notify: ['modulesNotify', 'modulesNotifyDescription', 'notification'],
  billing: ['modulesBilling', 'modulesBillingDescription', 'settings'],
  wechat: ['modulesWechat', 'modulesWechatDescription', 'notification'],
}
function Trash() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg> }

/** Manager chrome and module rows follow the approved HTML preview. */
export function ModuleManagerPanel({ snapshot, refresh, onClose, onConfigErased, t, api = moduleApi }: {
  snapshot: ModuleSnapshot | undefined
  refresh(): Promise<void>
  onClose(): void
  onConfigErased?(ids: string[]): void
  t: DetailTranslate
  api?: typeof moduleApi
}) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [update, setUpdate] = useState<ModuleUpdateStatus>()
  const [uninstall, setUninstall] = useState<string>()
  const [restore, setRestore] = useState<ModuleRestorePlan>()
  const [error, setError] = useState<string>()
  const [keepConfig, setKeepConfig] = useState(true)
  const [keepHistory, setKeepHistory] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const panel = useRef<HTMLDivElement>(null)
  const modal = useRef<HTMLDivElement>(null)
  const id = useId()
  const dialogOpen = uninstall !== undefined || restore !== undefined || error !== undefined
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => { panel.current?.toggleAttribute('inert', dialogOpen) }, [dialogOpen])
  useEffect(() => {
    const root = dialogOpen ? modal.current : panel.current
    if (!root) return
    const previous = document.activeElement as HTMLElement | null
    const controls = () => [...root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)')]
    controls()[0]?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = controls(), first = items[0], last = items.at(-1)
      const escaped = !root.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || escaped)) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || escaped)) {
        event.preventDefault(); first?.focus()
      }
    }
    root.addEventListener('keydown', trap)
    return () => { root.removeEventListener('keydown', trap); previous?.focus() }
  }, [dialogOpen])
  const run = async (action: () => Promise<unknown>) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true)
    try { await action(); await refresh() }
    catch (failure) { await refresh().catch(() => {}); if (active.current) setError(failure instanceof Error ? failure.message : 'MODULE_OPERATION_FAILED') }
    finally { busyRef.current = false; if (active.current) setBusy(false) }
  }
  const askUninstall = (module: string) => { setKeepConfig(true); setKeepHistory(true); setSelected([module]); setUninstall(module) }
  const closeDialog = () => { if (!busyRef.current) { setUninstall(undefined); setRestore(undefined); setError(undefined) } }
  const name = (module: string) => {
    if (module === 'plugin') return t('modulesWhole')
    const entry = labels[module]
    return entry ? t(entry[0]) : module
  }
  const confirmUninstall = () => run(async () => {
    if (!snapshot || !uninstall) return
    const next = await api.uninstall({ ids: uninstall === 'plugin' ? [] : selected, wholePlugin: uninstall === 'plugin', preserveData: keepConfig && keepHistory, preserveConfig: keepConfig, preserveHistory: keepHistory, expectedRevision: snapshot.revision })
    if (!keepConfig) {
      const keys = uninstall === 'plugin' ? ['balance-pos', 'show-whale-girl', 'show-usage-overview'] : [
        ...selected.includes('pet') ? ['show-whale-girl'] : [], ...selected.includes('overview') ? ['show-usage-overview'] : [],
      ]
      for (const key of keys) localStorage.removeItem(`dsh-token-monitor-${key}`)
      onConfigErased?.(uninstall === 'plugin' ? ['pet', 'overview'] : selected)
    }
    if (active.current) setUninstall(undefined)
    if (next.cleanupErrors?.length) throw new Error(next.cleanupErrors.join('\n'))
    if (next.pluginRemoved && !next.cleanupPending) onClose()
  })
  const confirmRestore = (upgrade: boolean) => run(async () => {
    if (!snapshot || !restore) return
    await api.restore({ id: restore.id, upgrade, expectedRevision: snapshot.revision })
    if (active.current) setRestore(undefined)
  })
  const installUpdate = () => {
    const revision = snapshot?.revision
    if (revision === undefined) return
    void run(async () => { await api.update(revision); if (active.current) setUpdate(undefined) })
  }
  return <>
    <Modal open headless title={t('modulesTitle')} onClose={() => { if (!busyRef.current && !dialogOpen) onClose() }} className={css.shell ?? ''}>
      <div
        ref={panel}
        // The panel is rendered through Modal's body portal but remains a
        // descendant of BalanceWidget in React's event tree. Stop pointer
        // events here so the draggable balance card cannot capture a click
        // intended for the manager controls.
        onPointerDown={event => event.stopPropagation()}
        onPointerMove={event => event.stopPropagation()}
        onPointerUp={event => event.stopPropagation()}
        onPointerCancel={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onContextMenu={event => event.stopPropagation()}
      >
        <header className={css.head}><img className={css.ribbon} src={asset('cute-decoration-ribbon')} alt="" /><h1>{t('modulesTitle')}</h1><button type="button" className={css.close} aria-label={t('modulesClose')} disabled={busy} onClick={onClose}><img src={asset('cute-icon-close')} alt="" /></button></header>
        <div className={css.body}>
          <div className={css.version}><div className={css.versionCopy}><span>{t('modulesVersion')} <strong>{snapshot ? `v${snapshot.version}` : '—'}</strong></span><span id={`${id}-module-update-status`} className={css.updateState} role="status">{snapshot?.restartRequired ? t('modulesRestart') : update ? !update.compatible ? t('modulesNoPackage') : t('modulesLatest', { version: update.latestVersion }) : t('modulesUnchecked')}</span></div>
            <div className={css.updateActions}>
              <a className={css.community} href="https://github.com/wssfk12138/dsh-damage-pulse" target="_blank" rel="noreferrer noopener" aria-label={t('modulesGithub')} title={t('modulesGithub')}><ManagerCommunityIcon kind="github" /></a>
              <button type="button" className={css.check} disabled={busy || !snapshot || snapshot.restartRequired} onClick={() => { void run(async () => { const result = await api.check(); if (active.current) setUpdate(result) }) }}>{t('modulesCheck')}</button>
              <button type="button" className={css.install} aria-describedby={`${id}-module-update-status`} title={!update ? t('modulesUnchecked') : !update.hasUpdate ? t('modulesLatest', { version: update.latestVersion }) : !update.compatible ? t('modulesNoPackage') : undefined} disabled={busy || !snapshot || snapshot.restartRequired || !update?.hasUpdate || !update.compatible} onClick={installUpdate}>{t('modulesInstall')}</button>
              <a className={css.community} href="https://github.com/wssfk12138/dsh-damage-pulse" target="_blank" rel="noreferrer noopener" aria-label={t('modulesStar')} title={t('modulesStar')}><ManagerCommunityIcon kind="star" /></a>
              <a className={css.community} href="mqqapi://card/show_pslcard?uin=1012639381&card_type=group" aria-label={t('modulesQQ')} title={t('modulesQQ')}><ManagerCommunityIcon kind="qq" /></a>
            </div>
          </div>
          <p className={css.note}>{t('modulesNote')}</p>
          {!snapshot && <p role="status">{t('modulesLoading')}</p>}
          <div className={css.grid}>{snapshot?.modules.map((module) => {
            const removed = module.status !== 'installed', pending = module.status === 'pending-delete', copy = labels[module.id]
            const status: DetailKey = module.status === 'pending-delete' ? 'modulesPending' : module.status === 'unavailable' ? 'modulesUnavailable' : removed ? 'modulesBlocked' : 'modulesInstalled'
            return <section key={module.id} className={`${css.row} ${removed ? css.blocked : ''}`}><div className={css.copy}><h2><img src={asset(`cute-icon-${copy?.[2] ?? 'settings'}`)} alt="" />{name(module.id)}</h2>{copy && <p>{t(copy[1])}</p>}</div><div className={css.status}><strong>{t(status)}</strong><button type="button" className={`${css.button} ${removed ? '' : `${css.danger} ${css.trash}`}`} disabled={busy || snapshot.restartRequired || snapshot.pluginRemoved} aria-label={`${t(pending ? 'modulesRetry' : removed ? 'modulesRestore' : 'modulesUninstall')} ${name(module.id)}`} title={`${t(pending ? 'modulesRetry' : removed ? 'modulesRestore' : 'modulesUninstall')} ${name(module.id)}`} onClick={() => { if (pending) askUninstall(module.id); else if (removed) void run(async () => { const plan = await api.plan(module.id); if (active.current) setRestore(plan) }); else askUninstall(module.id) }}>{pending ? <Trash /> : removed ? t('modulesRestore') : <Trash />}</button></div></section>
          })}</div>
          <section className={`${css.row} ${css.whole}`}><h2>{t('modulesWhole')}</h2><button type="button" className={`${css.button} ${css.danger} ${css.trash}`} aria-label={t('modulesWhole')} title={t('modulesWhole')} disabled={busy || !snapshot || snapshot.restartRequired} onClick={() => askUninstall('plugin')}><Trash /></button></section>
        </div>
      </div>
    </Modal>
    <Modal open={dialogOpen} headless title={t(error ? 'modulesError' : uninstall ? 'modulesUninstall' : 'modulesRestoreTitle')} onClose={closeDialog} className={css.confirm ?? ''}>
      <div
        ref={modal}
        onPointerDown={event => event.stopPropagation()}
        onPointerMove={event => event.stopPropagation()}
        onPointerUp={event => event.stopPropagation()}
        onPointerCancel={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onContextMenu={event => event.stopPropagation()}
      >
        {error ? <><h3>{t('modulesError')}</h3><pre role="alert">{t('modulesErrorCode', { code: error })}</pre><button type="button" className={css.button} disabled={busy} onClick={closeDialog}>{t('modulesClose')}</button></> : uninstall ? <>
          <h3>{t('modulesConfirm', { name: name(uninstall) })}</h3><p>{t(uninstall === 'plugin' ? 'modulesWholeRisk' : 'modulesRisk')}</p>
          {uninstall !== 'plugin' && <fieldset><legend>{t('modulesSelection')}</legend>{snapshot?.modules.filter(module => module.status === 'installed' || module.id === uninstall).map(module => <label key={module.id}><input type="checkbox" checked={selected.includes(module.id)} disabled={busy || module.id === uninstall} onChange={event => setSelected(previous => event.target.checked ? [...previous, module.id] : previous.filter(id => id !== module.id))} />{name(module.id)}</label>)}</fieldset>}
          <label htmlFor={`${id}-config`}><input id={`${id}-config`} type="checkbox" checked={keepConfig} disabled={busy} onChange={event => setKeepConfig(event.target.checked)} />{t('modulesKeepConfig')}</label>
          <label htmlFor={`${id}-history`}><input id={`${id}-history`} type="checkbox" checked={keepHistory} disabled={busy} onChange={event => setKeepHistory(event.target.checked)} />{t('modulesKeepHistory')}</label>
          <div className={css.actions}><button type="button" className={`${css.button} ${css.danger}`} disabled={busy} onClick={() => { void confirmUninstall() }}>{t(busy ? 'modulesWorking' : 'modulesUninstall')}</button><button type="button" className={css.button} disabled={busy} onClick={closeDialog}>{t('modulesCancel')}</button></div>
        </> : restore && <>
          <h3>{t('modulesRestoreTitle')}</h3><p>{t(!restore.currentAvailable ? 'modulesCurrentMissing' : restore.hasUpdate ? 'modulesRestoreUpgrade' : 'modulesRestoreExact', { version: restore.hasUpdate || !restore.currentAvailable ? restore.latestVersion : restore.currentVersion })}</p>
          <div className={css.actions}>{restore.currentAvailable && <button type="button" className={css.button} disabled={busy} onClick={() => { void confirmRestore(false) }}>{t('modulesRestoreCurrent')}</button>}{restore.hasUpdate && <button type="button" className={`${css.button} ${css.primary}`} disabled={busy} onClick={() => { void confirmRestore(true) }}>{t('modulesUpgradeRestore')}</button>}<button type="button" className={css.button} disabled={busy} onClick={closeDialog}>{t('modulesCancel')}</button></div>
        </>}
      </div>
    </Modal>
  </>
}
