/** Compact balance symbols; ISO codes stay unchanged in API data. */
export function currencySymbol(currency: string | undefined): string {
  if (!currency) return ''
  const symbols: Record<string, string> = { CNY: '￥', USD: '$', EUR: '€', JPY: '¥', GBP: '£', HKD: 'HK$', KRW: '₩', SGD: 'S$', AUD: 'A$', CAD: 'C$', INR: '₹', RUB: '₽', BRL: 'R$', TWD: 'NT$', THB: '฿', TRY: '₺', PLN: 'zł', VND: '₫', CHF: 'Fr' }
  if (symbols[currency]) return symbols[currency]
  try { return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(part => part.type === 'currency')?.value ?? currency }
  catch { return currency }
}
