import type { DetailRow } from '@deepseek-ai/dsh-token-monitor-contract'
import type { DetailKey, DetailTranslate } from './detail-locales.ts'
import { BillingSourceDetails } from './BillingSourceDetails.tsx'
import css from './UsageDetailsWindow.module.css'

const reasons: Record<string, DetailKey> = { 'provider-disabled': 'feeProviderDisabled', 'model-disabled': 'feeModelDisabled', 'rule-missing': 'feeRuleMissing', 'rate-missing': 'feeRateMissing', 'invalid-usage': 'feeInvalidUsage' }

/**
 * Read only recorded settlement facts, including absent legacy fields.
 * @param props - Frozen detail record and localized copy.
 * @returns The anchored fee detail content.
 */
export function FeeExplanation({ row, t }: { row: DetailRow; t: DetailTranslate }) {
  const facts = row.feeExplanation, applied = facts?.applied
  const rate = applied?.rate
  const categories = [
    { costKey: 'feeInputCost', tokenKey: 'feeInputTokens', rateKey: 'feeInputRate', count: row.inputTokens, rate: rate?.input, cost: facts?.costInput, tone: css.feeInput },
    { costKey: 'feeCacheCost', tokenKey: 'feeCacheTokens', rateKey: 'feeCacheRate', count: row.cacheReadTokens, rate: rate?.cacheHit, cost: facts?.costCacheRead, tone: css.feeCache },
    { costKey: 'feeWriteCost', tokenKey: 'feeWriteTokens', rateKey: 'feeWriteRate', count: row.cacheWriteTokens, rate: rate?.cacheWrite === 'input' ? rate.input : rate?.cacheWrite, cost: facts?.costCacheWrite, tone: undefined },
    { costKey: 'feeOutputCost', tokenKey: 'feeOutputTokens', rateKey: 'feeOutputRate', count: row.outputTokens, rate: rate?.output, cost: facts?.costOutput, tone: css.feeOutput },
  ] as const
  const value = (item: number | undefined | null) => item === undefined ? t('unknown') : item === null ? t('unpriced') : String(item)
  const money = (item: number | undefined | null) => typeof item === 'number' ? '¥' + item.toFixed(6) : value(item)
  const rateValue = (item: number | undefined | null) => typeof item === 'number' ? t('feeRateValue', { rate: item }) : value(item)
  return <div className={css.explanation}>
    <h2>{t('feeDetails')}</h2>
    <dl className={css.feeFields}>{categories.map(item =>
      <div className={css.feeField} key={item.costKey}>
        <dt>{t(item.costKey)}</dt><dd className={item.tone}>{money(item.cost)}</dd>
      </div>)}</dl>
    <div className={css.feeDivider} />
    <dl className={css.feeFields}>{categories.map(item =>
      <div className={css.feeField} key={item.tokenKey}><dt>{t(item.tokenKey)}</dt>
        <dd>{item.count === undefined ? t('unknown') : item.count.toLocaleString('zh-CN')}</dd></div>)}</dl>
    <div className={css.feeDivider} />
    <dl className={css.feeFields}>
      {categories.map(item => <div className={css.feeField} key={item.rateKey}>
        <dt>{t(item.rateKey)}</dt><dd className={item.tone}>{rateValue(item.rate)}</dd>
      </div>)}
      <div className={css.feeField}><dt>{t('feeMode')}</dt><dd>{applied ? t(applied.mode === 'fixed' ? 'billingFixed' : applied.mode === 'peak' ? 'billingPeak' : 'billingOffPeak') : t('unknown')}</dd></div>
      <div className={css.feeField}><dt>{t('feeTier')}</dt><dd>{!applied ? t('unknown') : applied.tierMax === undefined ? t('feeBase') : applied.tierMax === null ? t('billingUnlimited') : applied.tierMax.toLocaleString('zh-CN')}</dd></div>
      <div className={css.feeField}><dt>{t('billingMultiplier')}</dt><dd>{value(row.modelMultiplier)}</dd></div>
      <div className={css.feeField}><dt>{t('feeRuleId')}</dt><dd>{applied?.ruleId ?? t('unknown')}</dd></div>
      <div className={css.feeField}><dt>{t('feeTotal')}</dt><dd className={css.feeTotal}>{money(row.cost)}</dd></div>
      {facts?.reason && <div className={css.feeField}><dt>{t('feeReason')}</dt><dd>{t(reasons[facts.reason] ?? 'unknown')}</dd></div>}
    </dl>
    <p className={css.feeNote}>{t('feeFrozen')} {t('feeRounding')}</p>
    {!applied && <p className={css.feeNote}>{t('feeMissing')}</p>}
    <div className={css.feeSource}><BillingSourceDetails source={facts?.rule?.source} t={t} /></div>
  </div>
}
