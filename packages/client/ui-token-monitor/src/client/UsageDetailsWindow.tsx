import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Input, Menu, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DetailPage, DetailRow } from '@deepseek-ai/dsh-token-monitor-contract'
import type { DetailKey, DetailTranslate } from './detail-locales.ts'
import { beijingDateTime, compactTokens, latencyTone, parseBeijing } from './detail-model.ts'
import { FloatingResizeHandles, overlayTopMargin, useFloatingWindow } from './window-frame.tsx'
import { columnsKey, defaultColumns, detailColumns, readColumns, type DetailColumn } from './detail-columns.ts'
import styles from './UsageDetailsWindow.module.css'
const FeeExplanation = lazy(() => import('./FeeExplanation.tsx').then(module => ({ default: module.FeeExplanation })))
import { UsageOverview } from './UsageOverview.tsx'
import type { UsageSummaryRange } from './types.ts'

interface Filters {
  provider: string
  tab: string
  range: string
  model: string
  project: string
  session: string
  sessionText?: string
  errorType: string
  cancelled: boolean
  size: number
  from: string
  to: string
}
const initialFilters = (): Filters => ({ provider: '', tab: 'usage', range: 'today', model: '', project: '', session: '', errorType: '', cancelled: false, size: 20, from: beijingDateTime(Date.now()).slice(0, 10) + 'T00:00:00', to: beijingDateTime(Date.now()) })
const geometryKey = 'token-monitor.details.geometry.v1'
const initialRect = { x: 40, y: 60, width: 1100, height: 650 }
/** Height the portaled column list may grow to before it scrolls (see .menuSurface). */
const columnsMenuHeight = '--tm-detail-menu-max'
const columnsMenuCap = 460
const errorKeys = ['rate_limit', 'authentication', 'server', 'timeout', 'network', 'unknown'] as const
const errorLabel = (value: string | undefined, t: DetailTranslate) => t(errorKeys.includes(value as typeof errorKeys[number]) && value !== 'unknown' ? value as DetailKey : 'errorUnknown')

/** Nonmodal usage window; pointer capture is limited to its header and borders. */
export function UsageDetailsWindow({ onClose, t, billingInstalled = true }: {
  onClose: () => void
  t: DetailTranslate
  billingInstalled?: boolean
}) {
  const frame = useFloatingWindow(geometryKey, initialRect)
  const [filters, setFilters] = useState(initialFilters), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0)
  const [dates, setDates] = useState(() => ({ from: filters.from, to: filters.to }))
  const [appliedCustom, setAppliedCustom] = useState<{ from: number; to: number }>()
  const [sessionSearch, setSessionSearch] = useState('')
  const [filtersExpanded, setFiltersExpanded] = useState<boolean>()
  const [data, setData] = useState<DetailPage>(), [loading, setLoading] = useState(true), [error, setError] = useState<DetailKey>()
  const snapshot = useRef('')
  const [columns, setColumns] = useState(readColumns), [columnsOpen, setColumnsOpen] = useState(false)
  const [feePopover, setFeePopover] = useState<{ row: DetailRow; anchor: HTMLButtonElement; pinned: boolean }>()
  const feePopoverRef = useRef<HTMLElement>(null)
  const feeHideTimer = useRef<ReturnType<typeof setTimeout>>()
  const restoringFeeFocus = useRef(false)
  const columnsAnchor = useRef<HTMLSpanElement>(null)
  const [columnsSide, setColumnsSide] = useState<'bottom' | 'top'>('bottom')
  /**
   * 卡片方向与最大高度按按钮上下剩余空间算好，再交给宿主菜单摆放：
   * 空间不够时向上弹，并把高度限制在剩余空间内，卡片不会盖住按钮。
   */
  const fitColumnsMenu = useCallback(() => {
    const rect = columnsAnchor.current?.getBoundingClientRect()
    if (!rect) return
    const gap = 4, margin = 12
    const below = innerHeight - rect.bottom - gap - margin
    const above = rect.top - gap - overlayTopMargin(margin)
    const side = below >= above ? 'bottom' : 'top'
    const height = Math.min(columnsMenuCap, Math.max(96, side === 'bottom' ? below : above))
    document.documentElement.style.setProperty(columnsMenuHeight, height + 'px')
    setColumnsSide(side)
  }, [])
  /** 展开列设置：先量好方向与高度，第一帧就不会压住按钮。 */
  const toggleColumns = (open: boolean) => {
    if (!open) { setColumnsOpen(false); return }
    fitColumnsMenu()
    setColumnsOpen(true)
  }
  useEffect(() => {
    if (!columnsOpen) { document.documentElement.style.removeProperty(columnsMenuHeight); return }
    const refit = () => { fitColumnsMenu() }
    window.addEventListener('resize', refit)
    window.addEventListener('scroll', refit, true)
    return () => { window.removeEventListener('resize', refit); window.removeEventListener('scroll', refit, true) }
  }, [columnsOpen, fitColumnsMenu])
  useEffect(() => {
    if (!columnsOpen) return
    // 宿主菜单只在 document 捕获阶段收起；这里用更早的 window 捕获阶段兜底，
    // 保证点卡片外的任何空白处都能关闭列设置。
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (columnsAnchor.current?.contains(target)) return
      if (target instanceof Element && target.closest('[role="menu"]') !== null) return
      setColumnsOpen(false)
    }
    window.addEventListener('pointerdown', dismiss, true)
    return () => { window.removeEventListener('pointerdown', dismiss, true) }
  }, [columnsOpen])
  const clearFeeHide = () => { if (feeHideTimer.current) clearTimeout(feeHideTimer.current) }
  const scheduleFeeHide = () => {
    clearFeeHide()
    feeHideTimer.current = setTimeout(() => { setFeePopover(current => current?.pinned ? current : undefined) }, 180)
  }
  const showFee = (row: DetailRow, anchor: HTMLButtonElement) => {
    clearFeeHide()
    setFeePopover(current => current?.pinned ? current : { row, anchor, pinned: false })
  }
  useEffect(() => () => { clearFeeHide() }, [])
  useEffect(() => {
    if (!feePopover) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && (feePopover.anchor.contains(target) || feePopoverRef.current?.contains(target))) return
      setFeePopover(undefined)
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => { document.removeEventListener('pointerdown', dismiss, true) }
  }, [feePopover])
  useEffect(() => { clearFeeHide(); setFeePopover(undefined) }, [data, columns, billingInstalled])
  useEffect(() => { try { localStorage.setItem(columnsKey, JSON.stringify(columns)) } catch { /* Optional preference. */ } }, [columns])
  const titleRef = useRef<HTMLDivElement>(null)
  useEffect(() => { titleRef.current?.focus() }, [])
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      setLoading(true); setError(undefined)
      try {
        const params = new URLSearchParams({
          ...Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, String(value)])), page: String(page),
        })
        if (snapshot.current) params.set('snapshot', snapshot.current)
        if (filters.range === 'custom') {
          const from = parseBeijing(filters.from), to = parseBeijing(filters.to)
          if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) { setError('invalidTime'); setLoading(false); return }
          params.set('from', String(from)); params.set('to', String(to + 999))
        }
        const response = await fetch('/api/token-monitor/details?' + params.toString(), { signal: controller.signal })
        if (!response.ok) { setError(response.status === 409 ? 'expired' : 'failed'); return }
        const result = await response.json() as DetailPage
        if (!Array.isArray(result.rows) || !Array.isArray(result.sessions) || !Array.isArray(result.models) || !Number.isSafeInteger(result.pages)) throw new Error('Invalid details response')
        if (!controller.signal.aborted) { snapshot.current = result.snapshot; setData(result) }
      } catch { if (!controller.signal.aborted) setError('failed') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () =>{  controller.abort() }
  }, [filters, page, refresh])
  const change = (patch: Partial<Filters>) => { setFilters(value => ({ ...value, ...patch })); setPage(1) }
  const reload = () => { snapshot.current = ''; setPage(1); setRefresh(value => value + 1) }
  /** 应用自定义时间：使用记录与上方用量概览共用同一毫秒窗口，结束时间含整秒。 */
  const applyCustom = () => {
    change({ range: 'custom', ...dates })
    const from = parseBeijing(dates.from), to = parseBeijing(dates.to)
    setAppliedCustom(Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to >= from ? { from, to: to + 999 } : undefined)
  }
  /** 快捷时间范围只改共享 range，自定义窗口随之下线，避免概览继续用旧起止时间。 */
  const changeRange = (range: string, quick: boolean) => { change({ range }); setAppliedCustom(undefined); if (quick) reload() }
  const resetFilters = () => {
    if (!window.confirm(t('resetConfirm'))) return
    const next = initialFilters()
    setFilters(next)
    setDates({ from: next.from, to: next.to })
    setAppliedCustom(undefined)
    setSessionSearch('')
    reload()
  }
  const shown = frame.shown
  useLayoutEffect(() => {
    if (!feePopover) return
    const position = () => {
      const panel = feePopoverRef.current
      if (!panel) return
      if (!feePopover.anchor.isConnected) { setFeePopover(undefined); return }
      const anchor = feePopover.anchor.getBoundingClientRect()
      const width = panel.offsetWidth, height = panel.offsetHeight
      const left = anchor.right + width + 18 <= innerWidth ? anchor.right + 10 : anchor.left - width - 10
      panel.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, left))}px`
      panel.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, anchor.top - Math.min(140, height / 3)))}px`
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(position)
    if (feePopoverRef.current) observer?.observe(feePopoverRef.current)
    return () => { observer?.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true) }
  }, [feePopover, shown.x, shown.y, shown.width, shown.height])
  const compact = shown.width < 600, short = shown.height < 450
  const showFilters = filtersExpanded ?? (!compact && !short)
  const projects = [...new Set(data?.sessions.map(item => item.project).filter(Boolean) ?? [])].sort()
  const sessions = data?.sessions.filter(item => !filters.project || item.project === filters.project) ?? []
  const sessionLabel = (item: typeof sessions[number]) => item.title + ' · ' + item.id + ' · ' + item.project
  const token = (value: number | undefined, label: DetailKey, symbol: string, className: string | undefined) => <span className={className} title={t(label) + ': ' + (value === undefined ? t('unknown') : String(value))}>{symbol} {value === undefined ? t('unknown') : compactTokens(value)}</span>
  const timing = (row: DetailRow, total: boolean) => {
    const ms = total ? row.totalMs : row.firstMs
    return <div className={styles[latencyTone(ms, total)]}><div className={styles.timing}>{t(total ? 'total' : 'first')} {ms === undefined ? t('unknown') : t('duration', { value: (ms / 1000).toFixed(2) })}</div></div>
  }
  const visibleColumns = detailColumns.filter(id => columns.includes(id) && (id !== 'fee' || billingInstalled) && (id !== 'status' || filters.tab === 'errors'))
  const cell = (row: DetailRow, key: DetailColumn) => {
    const meta = data?.sessions.find(item => item.id === row.sessionId)
    switch (key) {
      case 'model': return <><div>{row.model}</div><div className={styles.secondary}>{meta?.child ? t('child') : row.provider}</div></>
      case 'session': return <><div className={styles.ellipsis} title={(meta?.title ?? row.sessionId) + ' · ' + row.sessionId}>{meta?.title ?? row.sessionId}</div><div className={styles.secondary}><div className={styles.ellipsis} title={meta?.project}>{meta?.project || t('missingProject')}</div></div></>
      case 'provider': return <div className={styles.ellipsis} title={row.provider}>{row.provider}</div>
      case 'project': return <div className={styles.ellipsis} title={meta?.project}>{meta?.project || t('missingProject')}</div>
      case 'tokens': return <><div className={styles.tokenPair}>{token(row.inputTokens, 'input', '↓', styles.input)}　{token(row.outputTokens, 'output', '↑', styles.output)}</div><div>{token(row.cacheReadTokens, 'cache', '◉', styles.cache)}</div></>
      case 'reasoningTokens': return <span title={row.reasoningTokens === undefined ? t('unknown') : String(row.reasoningTokens)}>{row.reasoningTokens === undefined ? t('unknown') : compactTokens(row.reasoningTokens)}</span>
      case 'reasoningEffort': return row.reasoningEffort ?? t('unknown')
      case 'fee': return <div className={styles.feeCell}><span>{row.billingStatus === 'unpriced' ? t('unpriced') : row.billingStatus === 'disabled' ? t('disabled') : row.cost === undefined ? t('unknown') : '¥' + row.cost.toFixed(6)}</span><button type="button" className={styles.feeInfo} aria-label={t('feeDetails')} aria-expanded={feePopover?.row.id === row.id} aria-controls="token-monitor-fee-popover"
        onPointerEnter={(event) => { showFee(row, event.currentTarget) }} onPointerLeave={scheduleFeeHide}
        onFocus={(event) => { if (!restoringFeeFocus.current) showFee(row, event.currentTarget) }} onBlur={scheduleFeeHide}
        onClick={(event) => { clearFeeHide(); setFeePopover(current => current?.row.id === row.id && current.pinned ? undefined : { row, anchor: event.currentTarget, pinned: true }) }}><span aria-hidden="true">i</span></button></div>
      case 'latency': return <div title={t('timingHint')}>{timing(row, false)}{timing(row, true)}</div>
      case 'time': return <div title={t('started') + ': ' + (row.startedAt === undefined ? t('unknown') : beijingDateTime(row.startedAt).replace('T', ' ')) + '\n' + t('ended') + ': ' + (row.endedAt === undefined ? t('unknown') : beijingDateTime(row.endedAt).replace('T', ' '))}><div>{beijingDateTime(row.timestamp).slice(0, 10)}</div><div>{beijingDateTime(row.timestamp).slice(11)}<span className={row.peak ? styles.peak : styles.valley}>{row.peak === undefined ? '—' : t(row.peak ? 'peak' : 'valley')}</span></div></div>
      case 'status': return <details className={styles.bad}><summary>{row.status === 'cancelled' ? t('cancelledStatus') : errorLabel(row.errorType, t)}</summary><div>{t('http')}: {row.httpStatus ?? t('unknown')}</div><div className={styles.secondary}>{t('errorSafe')}</div></details>
    }
  }
  return <>{createPortal(<section role="dialog" aria-modal="false" aria-label={t('title')} className={styles.window}
    data-compact={compact} data-short={short} data-condensed={shown.width < 950}
    style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height }}
    onPointerDown={(event) => { event.stopPropagation() }}
    onPointerMove={(event) => { event.stopPropagation() }} onPointerUp={(event) => { event.stopPropagation() }}
    onContextMenu={(event) =>{  event.stopPropagation() }} onKeyDown={(event) => {
      if (!(event.target as HTMLElement).closest('[role=menu]') || event.key === 'Escape') event.stopPropagation()
      if (event.key === 'Escape') { if (feePopover) { clearFeeHide(); setFeePopover(undefined) } else if (columnsOpen) { setColumnsOpen(false); columnsAnchor.current?.querySelector('button')?.focus() } else onClose() }
      if (event.key === 'Tab') setColumnsOpen(false)
    }}>
    <div ref={titleRef} tabIndex={-1} className={styles.title}
      onPointerDown={(event) => { frame.startDrag(event) }} onPointerMove={frame.moveDrag}
      onPointerUp={frame.endDrag} onPointerCancel={frame.endDrag}
      onDoubleClick={() => { frame.toggleMaximized() }}>
      <strong>{t('title')}</strong><div className={styles.actions}>
        <Button variant="ghost" aria-expanded={showFilters} onClick={() => { setFiltersExpanded(!showFilters) }}>{t(showFilters ? 'hideFilters' : 'showFilters')}</Button>
        <Button variant="ghost" aria-label={t(frame.maximized ? 'restore' : 'maximize')} onClick={() => { frame.toggleMaximized() }}>{frame.maximized ? '❐' : '□'}</Button><Button variant="ghost" aria-label={t('close')} onClick={onClose}>×</Button></div>
    </div>
    <div className={styles.contentScroll}>
      <div className={styles.top}>
        <UsageOverview billingInstalled={billingInstalled} t={t} compact={shown.width < 750} range={filters.range === 'custom' ? 'custom' : filters.range as UsageSummaryRange} appliedCustom={filters.range === 'custom' ? appliedCustom : undefined} provider={filters.provider} providers={data?.providers ?? []} onProviderChange={(provider) => { change({ provider, model: '' }) }} onRangeChange={(range) => { changeRange(range, false) }} />
        <div className={styles.controls} hidden={!showFilters}>
          <div className={styles.filters}>
            <label>{t('from')}<Input type="datetime-local" step={1} value={dates.from} onChange={(event) =>{  setDates(value => ({ ...value, from: event.target.value })) }} /></label>
            <label>{t('to')}<Input type="datetime-local" step={1} value={dates.to} onChange={(event) =>{  setDates(value => ({ ...value, to: event.target.value })) }} /></label>
            <Button variant="outline" onClick={applyCustom}>{t('apply')}</Button>
            <div className={styles.quick}>{(['all', '30d', '7d', 'yesterday', 'today'] as const).map(range => <Pill key={range} active={filters.range === range} onClick={() =>{  changeRange(range, true) }}>{t(range)}</Pill>)}</div>
          </div>
          <div className={styles.filters}>
            <label>{t('model')}<Input list="token-detail-models" placeholder={t('allModels')} value={filters.model} onChange={(event) =>{  change({ model: event.target.value }) }} /></label><datalist id="token-detail-models">{data?.models.map(model => <option key={model} value={model} />)}</datalist>
            <label>{t('project')}<Input list="token-detail-projects" placeholder={t('allProjects')} value={filters.project} onChange={(event) => { change({ project: event.target.value, session: '', sessionText: '' }); setSessionSearch('') }} /></label><datalist id="token-detail-projects">{projects.map(project => <option key={project} value={project} />)}</datalist>
            <label>{t('session')}<Input list="token-detail-sessions" placeholder={t('allSessions')} value={sessionSearch} onChange={(event) => {
              const value = event.target.value
              setSessionSearch(value)
              const selected = sessions.find(item => sessionLabel(item) === value || item.id === value)
              change({ session: selected?.id ?? '', sessionText: selected ? '' : value })
            }} /></label><datalist id="token-detail-sessions">{sessions.map(session => <option key={session.id} value={sessionLabel(session)} />)}</datalist>
            <div className={styles.quick}><Button variant="outline" onClick={reload} disabled={loading}>{t('refresh')}</Button><span ref={columnsAnchor}><Menu open={columnsOpen} portal dense autoFocus side={columnsSide} listClassName={styles.menuSurface}
              getAnchorRect={() => columnsAnchor.current?.getBoundingClientRect() ?? null}
              anchor={<Button variant="ghost" aria-expanded={columnsOpen} aria-haspopup="menu" onClick={() => { toggleColumns(!columnsOpen) }}>{t('columns')}</Button>}
              items={detailColumns.filter(id => (id !== 'fee' || billingInstalled) && (id !== 'status' || filters.tab === 'errors')).map(id => ({ id, label: t(id), disabled: columns.includes(id) && id !== 'status' && columns.filter(key => key !== 'status').length === 1 }))}
              selectedIds={columns} footer={[{ id: 'defaults', label: t('restoreColumns') }]}
              onClose={() => { setColumnsOpen(false) }} onSelect={(id) => {
                if (id === 'defaults') setColumns([...defaultColumns])
                else setColumns(value => value.includes(id as DetailColumn)
                  ? value.filter(key => key !== id)
                  : detailColumns.filter(key => key === id || value.includes(key)))
              }} /></span><Button variant="ghost" onClick={resetFilters}>{t('reset')}</Button></div>
          </div>
          <div className={styles.tabs}><Pill active={filters.tab === 'usage'} onClick={() =>{  change({ tab: 'usage' }) }}>{t('usage')}</Pill><Pill active={filters.tab === 'errors'} onClick={() =>{  change({ tab: 'errors' }) }}>{t('errors')}</Pill>
            {filters.tab === 'errors' && <><select className={styles.select} aria-label={t('errorType')} value={filters.errorType} onChange={(event) =>{  change({ errorType: event.target.value }) }}><option value="">{t('allErrors')}</option>{errorKeys.map(key => <option key={key} value={key}>{errorLabel(key, t)}</option>)}</select><label><input type="checkbox" checked={filters.cancelled} onChange={(event) =>{  change({ cancelled: event.target.checked }) }} />{t('cancelled')}</label></>}
          </div>
        </div>
      </div>
      <div className={styles.hint}>{t('scope')} · {data && t('captured', { time: beijingDateTime(data.capturedAt).replace('T', ' ') })}</div>
      {filters.tab === 'errors' && <div className={styles.hint}>{t('errorHistory')}</div>}
      <div className={styles.scroll} aria-busy={loading}>
        {error ? <div role="alert" className={styles.message}>{t(error)}</div> : loading ? <div role="status" className={styles.message}>{t('loading')}</div> : !data?.rows.length ? <div className={styles.message}>{t('empty')}</div> :
          <table className={styles.table}><thead><tr>{visibleColumns.map(key =>
            <th key={key} title={key === 'latency' ? t('timingHint') : undefined}>{t(key)}</th>)}</tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.id}>{visibleColumns.map(key =>
            <td key={key} data-column={key}>{cell(row, key)}</td>)}</tr>)}</tbody></table>}
      </div>
    </div>
    <footer className={styles.footer}><label>{t('pageSize')} <select className={styles.select} value={filters.size} onChange={(event) =>{  change({ size: Number(event.target.value) }) }}>{[20, 50, 100].map(size => <option key={size}>{size}</option>)}</select></label><span>{t('pages', { page: data?.page ?? 1, pages: data?.pages ?? 1, count: data?.total ?? 0 })}</span><Button variant="ghost" disabled={loading || !data || data.page <= 1} onClick={() =>{  setPage((data?.page ?? 1) - 1) }}>{t('prev')}</Button><Button variant="ghost" disabled={loading || !data || data.page >= data.pages} onClick={() =>{  setPage((data?.page ?? 1) + 1) }}>{t('next')}</Button></footer>
    <FloatingResizeHandles frame={frame} className={styles.resize} label={edge => t('resize') + ' · ' + t(edge)} />
  </section>, document.body)}
  {feePopover && createPortal(<section id="token-monitor-fee-popover" ref={feePopoverRef} role="region" aria-label={t('feeDetails')} className={styles.feePopover}
    onPointerEnter={clearFeeHide} onPointerLeave={scheduleFeeHide}
    onFocusCapture={clearFeeHide} onBlurCapture={scheduleFeeHide}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); clearFeeHide(); setFeePopover(undefined); restoringFeeFocus.current = true; feePopover.anchor.focus(); restoringFeeFocus.current = false } }}>
    <Suspense fallback={null}><FeeExplanation row={feePopover.row} t={t} /></Suspense>
  </section>, document.body)}</>
}
