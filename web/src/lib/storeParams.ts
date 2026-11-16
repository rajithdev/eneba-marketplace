/**
 * The store's state lives in the URL and nowhere else.
 *
 *   /store?platform=steam,xbox-live&region=europe&min_price=1000&sort=price_asc&page=2
 *
 * These are the API's own parameter names and values, so the address bar,
 * the request to the API and what is on screen are always the same thing.
 * That is what makes refresh, the back button and a shared link all work
 * without any extra code. These helpers only read and rewrite that string.
 */

/** Filters that hold several values, comma-separated. */
export const LIST_FILTERS = ['platform', 'region', 'type'] as const
export type ListFilter = (typeof LIST_FILTERS)[number]

const KNOWN = [...LIST_FILTERS, 'min_price', 'max_price', 'sort', 'page'] as const

/** The values currently chosen for a list filter. */
export function selected(params: URLSearchParams, key: ListFilter): string[] {
  return (params.get(key) ?? '').split(',').filter(Boolean)
}

/** A copy with one value of a list filter switched on or off. */
export function withToggled(params: URLSearchParams, key: ListFilter, value: string): URLSearchParams {
  const current = selected(params, key)
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]

  return withValue(params, key, next.join(','))
}

/**
 * A copy with one parameter set, or removed when the value is empty.
 * Changing anything other than the page goes back to page 1: page 3 of the
 * old results means nothing for the new ones.
 */
export function withValue(params: URLSearchParams, key: (typeof KNOWN)[number], value: string | null): URLSearchParams {
  const next = new URLSearchParams(params)

  if (value) next.set(key, value)
  else next.delete(key)
  if (key !== 'page') next.delete('page')

  return next
}

/** A copy with every filter removed. The sort order is kept. */
export function withoutFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams()
  const sort = params.get('sort')
  if (sort) next.set('sort', sort)

  return next
}

/** How many filters are active, for the "Filters (2)" button. */
export function activeFilterCount(params: URLSearchParams): number {
  return (
    LIST_FILTERS.reduce((count, key) => count + selected(params, key).length, 0) +
    (params.get('min_price') ? 1 : 0) +
    (params.get('max_price') ? 1 : 0)
  )
}

/**
 * The query string sent to the API: only the parameters it knows, in a fixed
 * order, so equal filters always give the same string (and the same cache
 * entry) however the URL happened to be written.
 */
export function apiQuery(params: URLSearchParams): string {
  const query = new URLSearchParams()
  for (const key of KNOWN) {
    const value = params.get(key)
    if (value) query.set(key, value)
  }

  return query.toString()
}

/** "12.50" typed by a visitor becomes "1250" cents; anything else becomes null. */
export function eurosToCents(text: string): string | null {
  const value = Number(text.replace(',', '.'))

  return text.trim() !== '' && Number.isFinite(value) && value >= 0 ? String(Math.round(value * 100)) : null
}

/** "1250" cents becomes "12.50" for a price field; empty when not set. */
export function centsToEuros(cents: string | null): string {
  return cents && /^\d+$/.test(cents) ? (Number(cents) / 100).toFixed(2) : ''
}
