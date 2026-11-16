import { describe, expect, it } from 'vitest'
import { activeFilterCount, apiQuery, centsToEuros, eurosToCents, selected, withToggled, withValue, withoutFilters } from './storeParams'

const params = (query: string) => new URLSearchParams(query)

describe('store URL parameters', () => {
  it('reads the values of a comma-separated filter', () => {
    expect(selected(params('platform=steam,xbox-live'), 'platform')).toEqual(['steam', 'xbox-live'])
    expect(selected(params(''), 'platform')).toEqual([])
  })

  it('switches one value of a filter on and off', () => {
    expect(withToggled(params(''), 'platform', 'steam').toString()).toBe('platform=steam')
    expect(decodeURIComponent(withToggled(params('platform=steam'), 'platform', 'psn').toString())).toBe('platform=steam,psn')
    expect(withToggled(params('platform=steam'), 'platform', 'steam').toString()).toBe('')
  })

  it('goes back to the first page whenever a filter or the sort changes', () => {
    expect(withToggled(params('page=3'), 'region', 'europe').toString()).toBe('region=europe')
    expect(withValue(params('page=3&platform=steam'), 'sort', 'price_asc').toString()).toBe('platform=steam&sort=price_asc')
    // ...but changing the page keeps everything else.
    expect(withValue(params('platform=steam&sort=price_asc'), 'page', '2').toString()).toBe('platform=steam&sort=price_asc&page=2')
  })

  it('clears every filter but keeps the chosen sort order', () => {
    expect(withoutFilters(params('platform=steam&min_price=100&sort=newest&page=2')).toString()).toBe('sort=newest')
  })

  it('counts active filters', () => {
    expect(activeFilterCount(params('platform=steam,psn&region=europe&min_price=100&sort=newest'))).toBe(4)
    expect(activeFilterCount(params('sort=newest&page=2'))).toBe(0)
  })

  it('sends the API only parameters it knows, in a fixed order', () => {
    expect(apiQuery(params('utm_source=x&page=2&sort=newest&platform=steam'))).toBe('platform=steam&sort=newest&page=2')
    expect(apiQuery(params('sort=newest&platform=steam&page=2'))).toBe('platform=steam&sort=newest&page=2')
  })

  it('converts between the euros a visitor types and the cents the API uses', () => {
    expect(eurosToCents('10')).toBe('1000')
    expect(eurosToCents('12.5')).toBe('1250')
    expect(eurosToCents('12,50')).toBe('1250')
    expect(eurosToCents('')).toBeNull()
    expect(eurosToCents('cheap')).toBeNull()
    expect(eurosToCents('-5')).toBeNull()
    expect(centsToEuros('1250')).toBe('12.50')
    expect(centsToEuros(null)).toBe('')
  })
})
