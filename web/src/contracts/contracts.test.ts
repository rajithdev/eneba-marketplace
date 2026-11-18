import { expect, it } from 'vitest'
import type { AccountSummaryResponse } from '../lib/account'
import type { FiltersResponse, ProductDetailResponse, ProductListResponse, SuggestionsResponse } from '../lib/catalog'
import type { CartChangedResponse, OrderListResponse, OrderResponse, QuoteResponse } from '../lib/checkout'
import type { HomepageResponse } from '../lib/homepage'
import summaryExample from './account.summary.json'
import quoteExample from './cart.quote.json'
import filtersExample from './filters.json'
import homepageExample from './homepage.json'
import cartChangedExample from './orders.cart-changed.json'
import declinedExample from './orders.declined.json'
import ordersExample from './orders.list.json'
import paidExample from './orders.paid.json'
import pendingExample from './orders.pending.json'
import listExample from './products.list.json'
import showExample from './products.show.json'
import suggestionsExample from './search.suggestions.json'

/**
 * The contract between the API and this frontend.
 *
 * The assignments below are checked by the TYPE CHECKER, not at run
 * time: if a field the API really returns (recorded in these example files
 * by the backend's own tests) is missing from, or typed differently in, the
 * TypeScript types the app uses, `npm run typecheck` and the build fail.
 */
const list: ProductListResponse = listExample.response
const show: ProductDetailResponse = showExample.response
const filters: FiltersResponse = filtersExample.response
const suggestions: SuggestionsResponse = suggestionsExample.response
const quote: QuoteResponse = quoteExample.response
const cartChanged: CartChangedResponse = cartChangedExample.response
const pending: OrderResponse = pendingExample.response
const paid: OrderResponse = paidExample.response
const declined: OrderResponse = declinedExample.response
const orders: OrderListResponse = ordersExample.response
const homepage: HomepageResponse = homepageExample.response
const summary: AccountSummaryResponse = summaryExample.response

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

  // A cart with a changed price; an order before, after and without payment.
  expect(quote.data.ok).toBe(false)
  expect(quote.data.lines.some((line) => line.issues.includes('price_changed'))).toBe(true)
  expect(cartChanged.code).toBe('cart_changed')
  expect(pending.data.status).toBe('pending')
  expect(pending.data.payment_methods.length).toBeGreaterThan(1)
  expect(pending.data.items.every((item) => item.keys.length === 0)).toBe(true)
  expect(paid.data.status).toBe('paid')
  expect(paid.data.items.every((item) => item.keys.length === item.quantity)).toBe(true)
  expect(declined.data.status).toBe('failed')
  expect(declined.data.items.every((item) => item.keys.length === 0)).toBe(true)
  // The order history never carries keys.
  expect(orders.data.length).toBeGreaterThan(1)
  expect(JSON.stringify(orders)).not.toContain('"keys"')
  // The dashboard's totals: counts and a sum, never a key.
  expect(summary.data.keys_count).toBeGreaterThan(0)
  expect(JSON.stringify(summary)).not.toContain('XXXXX')

  // A hero with banners, then three product blocks.
  expect(homepage.data.blocks.map((block) => block.type)).toEqual(['hero_banner', 'best_sellers', 'deals', 'featured'])
  expect(homepage.data.blocks[0].data.banners?.length).toBeGreaterThan(1)
  expect(homepage.data.blocks.slice(1).every((block) => (block.data.products?.length ?? 0) > 1)).toBe(true)
})
