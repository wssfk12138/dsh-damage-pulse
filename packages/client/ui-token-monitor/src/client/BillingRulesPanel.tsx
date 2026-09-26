import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { emptyBillingRule, normalizeMultiplier, validateBillingRules } from '@deepseek-ai/dsh-token-monitor-contract'
import type { BillingModelRule, BillingRules, BillingSnapshot } from '@deepseek-ai/dsh-token-monitor-contract'
import { zh } from './detail-locales.ts'
import type { DetailKey, DetailTranslate } from './detail-locales.ts'
import css from './BillingRulesPanel.module.css'
import { readBillingSnapshot as readSnapshot, type BillingEventsState } from './billingEvents.ts'
import { BillingSourceDetails } from './BillingSourceDetails.tsx'
import { BillingTemplatePreview } from './BillingTemplatePreview.tsx'
import { BalanceScriptEditor } from './BalanceScriptEditor.tsx'

type CatalogModel = { provider: string; providerName?: string | undefined; model: string; name?: string | undefined }
type CatalogLoaderResult = {
  groups: readonly { id: string; name?: string; models: readonly { id: string; name?: string }[] }[]
  failures: readonly { id: string; name?: string; message: string }[]
}
type Props = {
  onClose: () => void
  t?: DetailTranslate | undefined
  billingEvents?: BillingEventsState | undefined
  loadModelCatalog?: (() => Promise<CatalogLoaderResult>) | undefined
}
type Price = BillingModelRule['fixed']
const priceKeys = ['input', 'cacheHit', 'output'] as const
const priceLabels = { input: 'billingInput', cacheHit: 'billingCache', output: 'billingOutput' } as const
const modelKey = (row: CatalogModel) => JSON.stringify([row.provider, row.model])
const modelLabel = (row: CatalogModel) => (row.providerName ?? row.provider) + ' / ' + (row.name ?? row.model)
const splitKey = 'token-monitor.billing.split.v1'
function initialSplit(): number {
  try {
    const value = Number(localStorage.getItem(splitKey))
    if (Number.isFinite(value) && value >= 0.25 && value <= 0.6) return value
  } catch { /* The ratio is an optional local preference. */ }
  return 0.35
}

/** Dictionary lookup for a renderer that mounts the panel without the host translate function. */
function fallbackTranslate(key: DetailKey, params?: Record<string, unknown>): string {
  const template: string = zh[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  })
}

function hasPrices(rule: BillingModelRule | undefined): boolean {
  if (!rule) return false
  const activePrices = (tiers: BillingModelRule['tiers'], base: Price) => tiers?.length ? tiers : [base]
  const prices = rule.mode === 'peak'
    ? [...activePrices(rule.peakTiers ?? rule.tiers, rule.peak), ...activePrices(rule.offPeakTiers ?? rule.tiers, rule.offPeak)]
    : activePrices(rule.tiers, rule.fixed)
  return prices.some(price => priceKeys.some(key => price[key] !== null) || typeof price.cacheWrite === 'number')
}

function CacheWriteField({ price, onChange, title, t }: {
  price: Price
  onChange: (price: Price) => void
  title: string
  t: DetailTranslate
}) {
  const inherited = price.cacheWrite === undefined || price.cacheWrite === 'input'
  return <div className={css.cacheWrite}>
    <label><span>{t('billingCacheWrite')}</span>
      <select aria-label={t('billingPriceLabel', { title, field: t('billingCacheWriteMode') })} value={inherited ? 'input' : 'independent'}
        onChange={(event) => { onChange({ ...price, cacheWrite: event.target.value === 'input' ? 'input' : null }) }}>
        <option value="input">{t('billingInheritInput')}</option><option value="independent">{t('billingIndependent')}</option>
      </select>
    </label>
    <input aria-label={t('billingPriceLabel', { title, field: t('billingCacheWrite') })} type="number" min="0" step="any"
      disabled={inherited} value={inherited ? price.input ?? '' : price.cacheWrite ?? ''}
      onChange={(event) => { onChange({ ...price, cacheWrite: event.target.value === '' ? null : Number(event.target.value) }) }} />
  </div>
}

function PriceFields({ title, price, onChange, t }: {
  title: string
  price: Price
  onChange: (price: Price) => void
  t: DetailTranslate
}) {
  return <fieldset className={css.priceRow}>
    <legend className={css.visuallyHidden}>{title}</legend><strong>{title}</strong>
    {priceKeys.map(key => <label key={key}>
      <span>{t(priceLabels[key])}</span>
      <input aria-label={t('billingPriceLabel', { title, field: t(priceLabels[key]) })}
        type="number" min="0" step="any" value={price[key] ?? ''}
        onChange={(event) => { onChange({ ...price, [key]: event.target.value === '' ? null : Number(event.target.value) }) }} />
    </label>)}
    <CacheWriteField price={price} onChange={onChange} title={title} t={t} />
  </fieldset>
}

function PeriodFields({ periods, onChange, t }: {
  periods: BillingModelRule['periods']
  onChange: (periods: BillingModelRule['periods']) => void
  t: DetailTranslate
}) {
  const update = (index: number, patch: Partial<typeof periods[number]>) => {
    onChange(periods.map((period, i) => i === index ? { ...period, ...patch } : period))
  }
  return <div className={css.stack}>
    <h4>{t('billingPeriods')}</h4><p className={css.hint}>{t('billingPeriodHint')}</p>
    {periods.map((period, index) => <fieldset key={index} className={css.period}>
      <legend className={css.visuallyHidden}>{t('billingPeriodLabel', { index: index + 1, field: t('billingDays') })}</legend>
      <div className={css.days}>
        {[1, 2, 3, 4, 5, 6, 0].map(day => <label key={day} className={css.checkbox}>
          <input type="checkbox" checked={period.days.includes(day)}
            aria-label={t('billingPeriodLabel', { index: index + 1, field: t('billingDay', { day: day || t('billingSunday') }) })}
            onChange={(event) => {
              update(index, { days: event.target.checked ? [...period.days, day] : period.days.filter(value => value !== day) })
            }} />{t('billingDay', { day: day || t('billingSunday') })}
        </label>)}
      </div>
      <div className={css.periodTimes}>
        {(['start', 'end'] as const).map(key => <div key={key}>
          <span>{t(key === 'start' ? 'billingStart' : 'billingEnd')}</span>
          <div className={css.timeSelect}>
            <select aria-label={t('billingTimeLabel', { index: index + 1, field: t(key === 'start' ? 'billingStart' : 'billingEnd'), unit: t('billingHour') })}
              value={Math.floor(period[key] / 60)} onChange={(event) => {
                const hour = Number(event.target.value)
                update(index, { [key]: hour * 60 + (hour === 24 ? 0 : period[key] % 60) })
              }}>
              {Array.from({ length: key === 'end' ? 25 : 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}</option>)}
            </select><span aria-hidden="true">:</span>
            <select aria-label={t('billingTimeLabel', { index: index + 1, field: t(key === 'start' ? 'billingStart' : 'billingEnd'), unit: t('billingMinute') })}
              disabled={period[key] === 1440} value={period[key] % 60}
              onChange={(event) => { update(index, { [key]: Math.floor(period[key] / 60) * 60 + Number(event.target.value) }) }}>
              {Array.from({ length: 60 }, (_, minute) => <option key={minute} value={minute}>{String(minute).padStart(2, '0')}</option>)}
            </select>
          </div>
        </div>)}
        <Button className={css.icon} aria-label={t('billingDeletePeriod', { index: index + 1 })}
          onClick={() => { onChange(periods.filter((_, i) => i !== index)) }}>×</Button>
      </div>
    </fieldset>)}
    <Button className={css.add} onClick={() => { onChange([...periods, { days: [1, 2, 3, 4, 5], start: 540, end: 720 }]) }}>
      {t('billingAddPeriod')}
    </Button>
  </div>
}

function TierFields({ tiers, onChange, t, title }: {
  title?: string
  tiers: NonNullable<BillingModelRule['tiers']>
  onChange: (tiers: NonNullable<BillingModelRule['tiers']>) => void
  t: DetailTranslate
}) {
  const update = (index: number, patch: Partial<typeof tiers[number]>) => {
    onChange(tiers.map((tier, i) => i === index ? { ...tier, ...patch } : tier))
  }
  const label = (value: string) => title ? t('billingPriceLabel', { title, field: value }) : value
  const add = () => {
    const last = tiers.at(-1)
    if (!last || last.maxInputTokens !== null) {
      onChange([...tiers, { maxInputTokens: null, input: null, cacheHit: null, output: null }])
      return
    }
    const previousLimit = tiers.at(-2)?.maxInputTokens ?? 0
    onChange([...tiers.slice(0, -1), { ...last, maxInputTokens: previousLimit + 1 }, last])
  }
  return <div className={css.stack}>
    {tiers.map((tier, index) => <div key={index} className={css.tierRow}>
      <label><span>{t('billingTierLimit')}</span>
        <input aria-label={label(t('billingTierLabel', { index: index + 1, field: t('billingTierLimit') }))}
          type="number" min="1" value={tier.maxInputTokens ?? ''} placeholder={t('billingUnlimited')}
          onChange={(event) => { update(index, { maxInputTokens: event.target.value === '' ? null : Number(event.target.value) }) }} />
      </label>
      {priceKeys.map(key => <label key={key}><span>{t(priceLabels[key])}</span>
        <input aria-label={label(t('billingTierLabel', { index: index + 1, field: t(priceLabels[key]) }))}
          type="number" min="0" step="any" value={tier[key] ?? ''}
          onChange={(event) => { update(index, { [key]: event.target.value === '' ? null : Number(event.target.value) }) }} />
      </label>)}
      <CacheWriteField price={tier} onChange={(price) => { update(index, price) }} title={label(t('billingTierName', { index: index + 1 }))} t={t} />
      <Button className={css.icon} aria-label={label(t('billingDeleteTier', { index: index + 1 }))}
        onClick={() => { onChange(tiers.filter((_, i) => i !== index)) }}>×</Button>
    </div>)}
    <Button className={css.add} onClick={add}>{label(t('billingAddTier'))}</Button>
  </div>
}

export function BillingRulesPanel({ onClose, loadModelCatalog, billingEvents, t = fallbackTranslate }: Props) {
  const [snapshot, setSnapshot] = useState<BillingSnapshot>()
  const [templates, setTemplates] = useState<BillingRules>()
  const [templatesFailed, setTemplatesFailed] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [previewTemplate, setPreviewTemplate] = useState<BillingModelRule>()
  const [draft, setDraft] = useState<BillingRules>()
  const [catalog, setCatalog] = useState<CatalogLoaderResult>({ groups: [], failures: [] })
  const [selectedProvider, setSelectedProvider] = useState('')
  const [providerFilter, setProviderFilter] = useState('')
  const [split, setSplit] = useState(initialSplit)
  const [selectedModel, setSelectedModel] = useState('')
  const [multipliers, setMultipliers] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [loadError, setLoadError] = useState(false)
  const [catalogError, setCatalogError] = useState(false)
  const [error, setError] = useState<DetailKey>()
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<'pricing' | 'balance'>('pricing')
  const [scriptOpened, setScriptOpened] = useState(false)
  const [scriptBusy, setScriptBusy] = useState(false)
  const editVersion = useRef(0)
  const [providerOpen, setProviderOpen] = useState(false)
  const [externalSnapshot, setExternalSnapshot] = useState<BillingSnapshot>()
  const dirty = useRef(false)
  const liveSnapshot = useRef<BillingSnapshot>()
  const pendingSnapshot = useRef<BillingSnapshot>()
  const providerMenu = useRef<HTMLDivElement>(null)
  const savePending = useRef(false)
  const catalogGeneration = useRef(0)
  const bodyRef = useRef<HTMLFieldSetElement>(null)
  const resizing = useRef(false)
  useEffect(() => {
    try { localStorage.setItem(splitKey, String(split)) } catch { /* Optional local preference. */ }
  }, [split])

  const loadRules = async (discard = false) => {
    const startedWith = liveSnapshot.current
    const version = editVersion.current
    setLoadError(false)
    try {
      const response = await fetch('/api/token-monitor/billing')
      if (!response.ok) throw new Error('Billing load failed')
      const next = readSnapshot(await response.json())
      if (liveSnapshot.current !== startedWith || version !== editVersion.current || (dirty.current && !discard)) return
      liveSnapshot.current = next
      dirty.current = false
      setError(undefined)
      setExternalSnapshot(undefined)
      setSaved(false)
      setSnapshot(next)
      setDraft(next.rules)
      setMultipliers({})
    } catch { setLoadError(true) }
  }
  const refreshCatalog = useCallback(async () => {
    const generation = ++catalogGeneration.current
    setRefreshing(true)
    setCatalogError(false)
    try {
      if (!loadModelCatalog) throw new Error('Model catalog unavailable')
      const next = await loadModelCatalog()
      if (generation === catalogGeneration.current) setCatalog(next)
    } catch {
      if (generation === catalogGeneration.current) setCatalogError(true)
    } finally {
      if (generation === catalogGeneration.current) setRefreshing(false)
    }
  }, [loadModelCatalog])
  useEffect(() => { void loadRules() }, [])
  const loadTemplates = async () => {
    setTemplatesFailed(false)
    try {
      const response = await fetch('/api/token-monitor/billing/templates')
      if (!response.ok) throw new Error('Template load failed')
      setTemplates(validateBillingRules(await response.json()))
    } catch { setTemplatesFailed(true) }
  }
  useEffect(() => { void loadTemplates() }, [])
  useEffect(() => {
    if (billingEvents?.invalid) { setLoadError(true); return }
    const next = billingEvents?.snapshot
    if (!next) return
    setLoadError(false)
    if (savePending.current) { pendingSnapshot.current = next; return }
    if (JSON.stringify(next) === JSON.stringify(liveSnapshot.current)) return
    if (JSON.stringify(next.rules) === JSON.stringify(liveSnapshot.current?.rules)) {
      liveSnapshot.current = next; setSnapshot(next); return
    }
    if (dirty.current) { setExternalSnapshot(next); setSaved(false); return }
    liveSnapshot.current = next
    setSnapshot(next); setDraft(next.rules); setMultipliers({}); setSaved(false); setExternalSnapshot(undefined)
  }, [billingEvents])
  useEffect(() => {
    void refreshCatalog()
    return () => { catalogGeneration.current += 1 }
  }, [refreshCatalog])
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!providerMenu.current?.contains(event.target as Node)) setProviderOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => { document.removeEventListener('pointerdown', close) }
  }, [])

  const rows = useMemo(() => {
    const combined = catalog.groups.flatMap(group => group.models.map(model => ({
      provider: group.id, providerName: group.name, model: model.id, name: model.name,
    })))
    return [...new Map(combined.map(row => [modelKey(row), row])).values()]
  }, [catalog])
  const providerIds = [...new Set([
    ...catalog.groups.map(group => group.id), ...catalog.failures.map(failure => failure.id),
  ])]
  const searchWords = query.trim().toLowerCase().split(/[\s/]+/).filter(Boolean)
  const visibleRows = rows.filter(row => (!providerFilter || row.provider === providerFilter)
    && searchWords.every(word => [row.provider, row.providerName, row.model, row.name].join(' ').toLowerCase().includes(word)))
  const providerRule = draft?.providers.find(provider => provider.provider === selectedProvider)
  const selectedRow = rows.find(row => row.provider === selectedProvider && row.model === selectedModel)
  const rule = selectedRow && (providerRule?.models.find(model => model.model === selectedModel) ?? emptyBillingRule(selectedModel))
  const selectedKey = modelKey({ provider: selectedProvider, model: selectedModel })
  const templateRows = templates?.providers.flatMap(provider => provider.models.map(rule => ({ id: provider.provider + '/' + rule.model, rule }))) ?? []
  const currentTemplate = templateRows.find(item => item.id === (rule?.source?.templateId ?? selectedProvider + '/' + selectedModel))
  const chosenTemplate = templateRows.find(item => item.id === templateId) ?? currentTemplate

  const select = (provider: string, model = '') => {
    setPreviewTemplate(undefined); setTemplateId('')
    setSelectedProvider(provider)
    setSelectedModel(model)
    setProviderOpen(false)
  }
  const updateProvider = (current: BillingRules, change: (provider: BillingRules['providers'][number]) => BillingRules['providers'][number]): BillingRules => {
    const existing = current.providers.find(provider => provider.provider === selectedProvider)
    const next = change(existing ?? { provider: selectedProvider, enabled: true, models: [] })
    if (existing === undefined) return { ...current, providers: [...current.providers, next] }
    return { ...current, providers: current.providers.map(provider => (provider === existing ? next : provider)) }
  }
  const update = (patch: Partial<BillingModelRule>) => {
    editVersion.current++
    setError(undefined)
    dirty.current = true
    setSaved(false)
    setDraft(current => current && updateProvider(current, (provider) => {
      const previous = provider.models.find(model => model.model === selectedModel)
      const model = previous ?? emptyBillingRule(selectedModel)
      const next = { ...model, ...patch,
        ...(patch.source ? { source: patch.source } : model.source ? { source: { ...model.source, modified: true } } : {}),
      }
      return { ...provider, models: previous ? provider.models.map(item => item === previous ? next : item) : [...provider.models, next] }
    }))
  }
  const save = async () => {
    if (!draft || !snapshot || savePending.current) return
    let rules: BillingRules
    try {
      rules = { ...draft, providers: draft.providers.map(provider => ({ ...provider, models: provider.models.map((model) => {
        const raw = multipliers[modelKey({ provider: provider.provider, model: model.model })]
        return { ...model, multiplier: normalizeMultiplier(raw === undefined ? model.multiplier : raw.trim() === '' ? '' : Number(raw)) }
      }) })) }
    } catch { setError('billingMultiplierInvalid'); return }
    try { rules = validateBillingRules(rules) } catch { setError('billingInvalid'); return }
    savePending.current = true
    const version = editVersion.current
    setSaving(true)
    setSaved(false)
    setError(undefined)
    try {
      const response = await fetch('/api/token-monitor/billing', { method: 'PUT',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: snapshot.revision, rules }),
      })
      if (!response.ok) {
        if (response.status === 409) {
          const fresh = await fetch('/api/token-monitor/billing')
          if (!fresh.ok) throw new Error('Billing reload failed')
          const latest = readSnapshot(await fresh.json())
          if (JSON.stringify(latest.rules) === JSON.stringify(snapshot.rules)) {
            liveSnapshot.current = latest; setSnapshot(latest)
          } else { setExternalSnapshot(latest); setError('billingConflict') }
        } else setError('billingSaveFailed')
        return
      }
      const next = readSnapshot(await response.json())
      liveSnapshot.current = next
      setSnapshot(next)
      if (version === editVersion.current) {
        dirty.current = false
        setDraft(next.rules)
        setMultipliers({})
        setSaved(true)
      }
      setExternalSnapshot(undefined)
    } catch { setError('billingSaveFailed') } finally {
      savePending.current = false
      setSaving(false)
      const pending = pendingSnapshot.current
      pendingSnapshot.current = undefined
      if (pending && pending.revision > (liveSnapshot.current?.revision ?? -1)) {
        const live = JSON.stringify(liveSnapshot.current?.rules)
        if (JSON.stringify(pending.rules) === live) { liveSnapshot.current = pending; setSnapshot(pending) }
        else if (dirty.current) setExternalSnapshot(pending)
        else { liveSnapshot.current = pending; setSnapshot(pending); setDraft(pending.rules); setMultipliers({}); setSaved(false) }
      }
    }
  }

  useEffect(() => {
    if (!dirty.current || saving || externalSnapshot || error) return
    const timer = setTimeout(() => { void save() }, 500)
    return () => { clearTimeout(timer) }
  }, [draft, multipliers, saving, snapshot, externalSnapshot, error])

  return <div role="dialog" aria-label={t('billingTitle')} className={css.panel}
    onPointerDown={(event) => { event.stopPropagation() }}>
    <header className={css.header}><strong>{t('billingHeading')}</strong>
      <div className={css.actions}>
        <span role={saving || saved ? 'status' : undefined}>{saving ? t('billingSaving') : saved ? t('billingSaved') : ''}</span>
        <Button className={css.icon} disabled={saving || dirty.current || scriptBusy} onClick={onClose} aria-label={t('close')}>×</Button>
      </div>
    </header>
    {loadError && <div role="alert">{t('billingLoadFailed')}
      <Button onClick={() => { void loadRules() }}>{t('billingRetry')}</Button>
    </div>}
    {error && <div role="alert">{t(error)}{error === 'billingSaveFailed' && <Button onClick={() => { void save() }}>{t('balanceRetry')}</Button>}
      {!externalSnapshot && <Button disabled={saving} onClick={() => { void loadRules(true) }}>{t('billingLoadLatest')}</Button>}
    </div>}
    {externalSnapshot && <div role="alert">{t('billingExternalChange')}
      <Button onClick={() => {
        liveSnapshot.current = externalSnapshot; dirty.current = false
        setSnapshot(externalSnapshot); setDraft(externalSnapshot.rules); setMultipliers({})
        setExternalSnapshot(undefined); setError(undefined); setSaved(false)
      }}>{t('billingLoadLatest')}</Button>
    </div>}
    {!draft && !loadError && <p>{t('loading')}</p>}
    <fieldset className={css.toolbar} disabled={!draft}>
      <div ref={providerMenu} className={css.providerMenu} onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setProviderOpen(false)
          providerMenu.current?.querySelector('button')?.focus()
          event.stopPropagation()
        }
      }}>
        <Button className={css.providerTrigger} aria-expanded={providerOpen} aria-haspopup="listbox"
          onClick={() => { setProviderOpen(value => !value) }}>
          <span>{catalog.groups.find(group => group.id === providerFilter)?.name ?? (providerFilter || t('billingAllProviders'))}</span><span aria-hidden="true">⌄</span>
        </Button>
        {providerOpen && <div role="listbox" aria-label={t('billingProvider')} className={css.providerOptions}>
          {['', ...providerIds].map(provider => <button key={provider} type="button" role="option"
            aria-selected={providerFilter === provider} onClick={() => { setProviderFilter(provider); if (provider && tab === 'balance') select(provider); setProviderOpen(false) }}>
            {catalog.groups.find(group => group.id === provider)?.name ?? (provider || t('billingAllProviders'))}
          </button>)}
        </div>}
      </div>
      <input placeholder={t('billingSearch')} aria-label={t('billingSearch')} value={query}
        onChange={(event) => { setQuery(event.target.value) }} />
      <Button className={css.icon} disabled={refreshing} aria-label={t('billingRefresh')} title={t('billingRefresh')}
        onClick={() => { void refreshCatalog() }}>↻</Button>
      <Button onClick={() => { setSplit(0.35) }}>{t('billingResetSplit')}</Button>
    </fieldset>
    <fieldset ref={bodyRef} className={css.body} disabled={!draft} style={{ '--billing-list-ratio': String(split * 100) + '%' } as CSSProperties}>
      <section className={css.sidebar}>
        {selectedProvider && <label className={css.checkbox}>
          <input type="checkbox" checked={providerRule?.enabled ?? true} onChange={(event) => {
            const enabled = event.target.checked
            dirty.current = true
            editVersion.current++
            setError(undefined)
            setSaved(false)
            setDraft(current => current && updateProvider(current, provider => ({ ...provider, enabled })))
          }} />{t('billingProviderEnabled')}
        </label>}
        {catalogError && <div role="alert">{t('billingCatalogFailed')}</div>}
        {catalog.failures.length > 0 && <div role="status" className={css.hint}>
          {t('billingProviderFailed', { names: catalog.failures.map(failure => failure.name ?? failure.id).join(', ') })}
        </div>}
        <div className={css.modelList}>
          {visibleRows.map((row) => {
            const provider = draft?.providers.find(item => item.provider === row.provider)
            const model = provider?.models.find(item => item.model === row.model)
            const status = provider?.enabled === false || model?.enabled === false ? t('disabled') : hasPrices(model) ? '' : t('unpriced')
            return <Button key={modelKey(row)} className={css.model} title={row.provider + ' / ' + row.model} aria-label={modelLabel(row)}
              aria-pressed={selectedProvider === row.provider && selectedModel === row.model}
              onClick={() => { select(row.provider, row.model) }}>
              <span>{modelLabel(row)}</span><small>{row.provider} / {row.model}{status && ' · ' + status}</small>
            </Button>
          })}
          {!refreshing && !visibleRows.length && <p className={css.hint}>{t('billingNoModels')}</p>}
        </div>
      </section>
      <div className={css.divider} role="separator" tabIndex={0} aria-label={t('billingSplit')} aria-orientation="vertical"
        aria-valuemin={25} aria-valuemax={60} aria-valuenow={Math.round(split * 100)}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          resizing.current = true; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault()
        }} onPointerMove={(event) => {
          const bounds = bodyRef.current?.getBoundingClientRect()
          if (!resizing.current || !bounds?.width) return
          const minimum = Math.max(0.25, 220 / bounds.width), maximum = Math.min(0.6, 1 - 340 / bounds.width)
          setSplit(Math.max(minimum, Math.min(maximum, (event.clientX - bounds.left) / bounds.width)))
        }} onPointerUp={() => { resizing.current = false }} onPointerCancel={() => { resizing.current = false }}
        onLostPointerCapture={() => { resizing.current = false }} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
          event.preventDefault(); setSplit(value => event.key === 'Home' ? 0.35 : Math.max(0.25, Math.min(0.6, value + (event.key === 'ArrowLeft' ? -0.025 : 0.025))))
        }} />
      <section className={css.editor}>
        <div className={css.modes} role="tablist" aria-label={t('billingHeading')}>
          <Button role="tab" aria-selected={tab === 'pricing'} onClick={() => { setTab('pricing') }}>{t('billingPricingTab')}</Button>
          <Button role="tab" aria-selected={tab === 'balance'} onClick={() => { setTab('balance'); setScriptOpened(true); if (providerFilter) select(providerFilter) }}>{t('balanceScriptTab')}</Button>
        </div>
        <div hidden={tab !== 'balance'}>
          {scriptOpened && <BalanceScriptEditor provider={selectedProvider} t={t} onBusyChange={setScriptBusy} />}
        </div>
        <div hidden={tab !== 'pricing'} className={css.stack}>
          {rule ? <>
            <h3 title={selectedRow.provider + ' / ' + rule.model}>{modelLabel(selectedRow)}</h3>
            <p className={css.hint}>{selectedRow.provider} / {rule.model}</p>
            <BillingSourceDetails source={rule.source} t={t} />
            {currentTemplate?.rule.source && rule.source && currentTemplate.rule.source.version !== rule.source.version && <p role="status">{t('billingTemplateChanged')}</p>}
            {templatesFailed ? <div role="alert">{t('billingTemplatesFailed')}<Button onClick={() => { void loadTemplates() }}>{t('billingRetry')}</Button></div> : <div className={css.stack}>
              <select aria-label={t('billingTemplatePreview')} value={chosenTemplate?.id ?? ''} onChange={(event) => { setTemplateId(event.target.value); setPreviewTemplate(undefined) }}>
                <option value="">{t('billingNoTemplate')}</option>
                {templateRows.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
              </select>
              <Button disabled={!chosenTemplate} onClick={() => { setPreviewTemplate(chosenTemplate?.rule) }}>{t('billingTemplatePreview')}</Button>
            </div>}
            {previewTemplate && <section className={css.source} aria-label={t('billingTemplatePreview')}>
              <p>{t('billingTemplateWarning')}</p>
              <h4>{t('billingCurrentDraft')}</h4><BillingTemplatePreview rule={rule} t={t} />
              <h4>{t('billingNewTemplate')}</h4><BillingTemplatePreview rule={previewTemplate} t={t} />
              <div className={css.actions}><Button onClick={() => {
                update({ ...structuredClone(previewTemplate), model: rule.model, enabled: rule.enabled })
                setMultipliers(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== selectedKey)))
                setPreviewTemplate(undefined)
              }}>{t('billingTemplateApply')}</Button><Button onClick={() => { setPreviewTemplate(undefined) }}>{t('billingTemplateCancel')}</Button></div>
            </section>}
            <label className={css.checkbox}>
              <input type="checkbox" checked={rule.enabled} onChange={(event) => { update({ enabled: event.target.checked }) }} />
              {t('billingModelEnabled')}
            </label>
            <label className={css.multiplier}>{t('billingMultiplier')}
              <input type="text" inputMode="decimal" value={multipliers[selectedKey] ?? String(rule.multiplier)}
                onChange={(event) => {
                  update({})
                  setMultipliers(current => ({ ...current, [selectedKey]: event.target.value }))
                  setSaved(false)
                }} />
            </label>
            <div className={css.modes}><span>{t('billingPrice')}</span>
              <Button aria-pressed={rule.mode === 'fixed'} onClick={() => { update({ mode: 'fixed' }) }}>{t('billingFixed')}</Button>
              <Button aria-pressed={rule.mode === 'peak'} onClick={() => { update({ mode: 'peak' }) }}>{t('billingPeakMode')}</Button>
            </div>
            {rule.mode === 'peak' && <>
              <PeriodFields t={t} periods={rule.periods} onChange={(periods) => { update({ periods }) }} />
              {(['peak', 'offPeak'] as const).map((period) => {
                const title = t(period === 'peak' ? 'billingPeak' : 'billingOffPeak')
                const tierKey = period === 'peak' ? 'peakTiers' : 'offPeakTiers'
                return <section key={period} className={css.stack}>
                  <PriceFields t={t} title={title} price={rule[period]} onChange={(price) => { update({ [period]: price }) }} />
                  <h4>{t('billingPriceLabel', { title, field: t('billingTiers') })}</h4>
                  <p className={css.hint}>{t('billingPeriodTierHint')}</p>
                  <TierFields t={t} title={title} tiers={rule[tierKey] ?? rule.tiers ?? []}
                    onChange={(tiers) => { update({ [tierKey]: tiers }) }} />
                </section>
              })}
            </>}
            {rule.mode === 'fixed' && <>
              <PriceFields t={t} title={t('billingRate')}
                price={rule.fixed} onChange={(fixed) => { update({ fixed }) }} />
              <h4>{t('billingTiers')}</h4><p className={css.hint}>{t('billingTierHint')}</p>
              <TierFields t={t} tiers={rule.tiers ?? []} onChange={(tiers) => { update({ tiers }) }} />
            </>}
          </> : <p>{t('billingSelect')}</p>}
        </div>
      </section>
    </fieldset>
  </div>
}
