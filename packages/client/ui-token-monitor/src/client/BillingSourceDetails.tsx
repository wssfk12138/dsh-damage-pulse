import type { BillingSource } from '@deepseek-ai/dsh-token-monitor-contract'
import type { DetailTranslate } from './detail-locales.ts'
import css from './BillingRulesPanel.module.css'

/**
 * Template attribution is displayed verbatim; absent dates never imply verification.
 * @param props - Recorded source metadata and localized copy.
 * @returns Collapsible attribution details or an explicit custom-source label.
 */
export function BillingSourceDetails({ source, t }: { source: BillingSource | undefined; t: DetailTranslate }) {
  return <details className={css.source}>
    <summary>{t('billingSource')} · {source ? t(source.modified ? 'billingModified' : 'billingOriginal') : t('billingSourceCustom')}{source?.verifiedAt ? '' : ' · ' + t('billingUnverified')}</summary>
    {source ? <dl>
      <dt>{t('billingSource')}</dt><dd>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a> : source.name}</dd>
      <dt>{t('billingVersion')}</dt><dd>{source.version}</dd>
      <dt>{t('billingVerified')}</dt><dd>{source.verifiedAt ?? t('billingUnverified')}</dd>
      <dt>{t('billingEffective')}</dt><dd>{source.effectiveAt ?? t('unknown')}</dd>
      <dt>{t('billingCurrency')}</dt><dd>{source.originalCurrency}</dd>
      <dt>{t('billingUnit')}</dt><dd>{source.originalUnit}</dd>
      <dt>{t('billingConversion')}</dt><dd>{source.conversionBasis}</dd>
    </dl> : <p>{t('billingSourceCustom')}</p>}
  </details>
}
