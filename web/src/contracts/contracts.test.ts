import { expect, it } from 'vitest'
import type { FiltersResponse, ProductDetailResponse, ProductListResponse, SuggestionsResponse } from '../lib/catalog'
import filtersExample from './filters.json'
import listExample from './products.list.json'
import showExample from './products.show.json'
import suggestionsExample from './search.suggestions.json'

/**
 * The contract between the API and this frontend.
 *
 * The three assignments below are checked by the TYPE CHECKER, not at run
 * time: if a field the API really returns (recorded in these example files
 * by the backend's own tests) is missing from, or typed differently in, the
 * TypeScript types the app uses, `npm run typecheck` and the build fail.
 */
const list: ProductListResponse = listExample.response
const show: ProductDetailResponse = showExample.response
const filters: FiltersResponse = filtersExample.response
const suggestions: SuggestionsResponse = suggestionsExample.response

it('the recorded examples cover the cases the pages must handle', () => {
  // A discounted product, a full-price one and a sold-out one.
  expect(list.data.some((product) => product.price?.discount_percent)).toBe(true)
  expect(list.data.some((product) => product.price && product.price.original_amount_cents === null)).toBe(true)
  expect(list.data.some((product) => !product.in_stock && product.price === null)).toBe(true)

  expect(show.data.offers.length).toBeGreaterThan(1)
  expect(show.data.variants.length).toBeGreaterThan(0)
  expect(filters.data.platforms.length).toBeGreaterThan(0)
  expect(filters.data.search.sort.value).toBe('relevance')
  expect(suggestions.data.length).toBeGreaterThan(0)
})
