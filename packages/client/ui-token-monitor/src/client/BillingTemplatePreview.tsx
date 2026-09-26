import type { BillingModelRule, BillingPrice } from '@deepseek-ai/dsh-token-monitor-contract'
import type { DetailTranslate } from './detail-locales.ts'
import { BillingSourceDetails } from './BillingSourceDetails.tsx'
import css from './BillingRulesPanel.module.css'

/**
 * Human-readable comparison uses the same four categories as the editor.
 * @param props - Proposed template rule and localized copy.
 * @returns Read-only prices, periods, tiers and source details.
 */
export function BillingTemplatePreview({ rule, t }: { rule: BillingModelRule; t: DetailTranslate }) {
  const rates = (price: BillingPrice) => [price.input, price.cacheHit, price.cacheWrite === undefined || price.cacheWrite === 'input' ? t('billingInheritInput') : price.cacheWrite, price.output]
    .map(value => value === null ? t('unpriced') : String(value)).join(' / ')
  const time = (minutes: number) => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0')
  return <div className={css.stack}>
    <p>{t('billingMultiplier')}: {rule.multiplier} · {t(rule.mode === 'fixed' ? 'billingFixed' : 'billingPeakMode')}</p>
    <p>{t('billingRate')} · {[t('billingInput'), t('billingCache'), t('billingCacheWrite'), t('billingOutput')].join(' / ')}</p>
    {(rule.mode === 'fixed' ? ['fixed'] as const : ['peak', 'offPeak'] as const).map((mode) => {
      const tiers = mode === 'fixed' ? rule.tiers : (mode === 'peak' ? rule.peakTiers : rule.offPeakTiers) ?? rule.tiers
      return <div key={mode}>
        <strong>{t(mode === 'fixed' ? 'billingFixed' : mode === 'peak' ? 'billingPeak' : 'billingOffPeak')}: {rates(rule[mode])}</strong>
        {tiers?.map((tier, index) => <p key={index}>{t('billingTierName', { index: index + 1 })} ≤ {tier.maxInputTokens ?? t('billingUnlimited')}: {rates(tier)}</p>)}
      </div>
    })}
    {rule.mode === 'peak' && <div>{t('billingPeriods')}{rule.periods.map((period, index) => <p key={index}>{period.days.map(day => t('billingDay', { day: day === 0 ? t('billingSunday') : day })).join(', ')} · {time(period.start)}–{time(period.end)}</p>)}</div>}
    <BillingSourceDetails source={rule.source} t={t} />
  </div>
}
