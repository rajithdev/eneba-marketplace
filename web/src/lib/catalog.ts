/**
 * The catalog API: the shape of each response, and the functions that fetch
 * them. The shapes mirror the backend's resource classes; the example
 * responses in src/contracts are type-checked against them (see
 * contracts.test.ts), so the two cannot drift apart unnoticed.
 */
import { apiFetch } from './api'

/** A price as the API reports it: whole cents, never decimals. */
export interface Money {
  amount_cents: number
  currency: string
  /** The struck-through "was" price, when the offer is discounted. */
  original_amount_cents: number | null
  discount_percent: number | null
}

export interface NamedOption {
  slug: string
  name: string
}

/** A product as shown on a store card or in a list of variants. */
export interface ProductSummary {
  slug: string
  name: string
  type: string
  cover_image_url: string | null
  release_date: string | null
  platform: NamedOption
  region: NamedOption
  /** False when every seller is out of keys. */
  in_stock: boolean
  /** The cheapest price that can be paid right now; null when sold out. */
  price: Money | null
  /** How many sellers can deliver a key right now. */
  offers_count: number
}

export interface Offer {
  id: number
  seller: { slug: string; name: string; rating_percent: number; sales_count: number }
  price: Money
  in_stock: boolean
}

export interface ProductDetail extends ProductSummary {
  game: { slug: string; title: string; description: string | null }
  /** Purchasable offers first, cheapest first. */
  offers: Offer[]
  /** The same game on other platforms and regions. */
  variants: ProductSummary[]
}

export interface ProductListResponse {
  data: ProductSummary[]
  meta: { current_page: number; per_page: number; total: number; last_page: number }
}

export interface ProductDetailResponse {
  data: ProductDetail
}

export interface FilterOption extends NamedOption {
  products_count: number
}

export interface FiltersResponse {
  data: {
    platforms: FilterOption[]
    regions: FilterOption[]
    types: { value: string; label: string; products_count: number }[]
    price: { min_cents: number | null; max_cents: number | null; currency: string }
    sorts: { value: string; label: string }[]
    default_sort: string
    /** What applies only while searching. */
    search: {
      /** An extra sort order, and the default one when there is a search term. */
      sort: { value: string; label: string }
      max_length: number
      suggestions_min_length: number
    }
    per_page: { default: number; max: number }
  }
}

/** `query` is a ready query string, as built by storeParams.apiQuery(). */
export const fetchProducts = (query: string) => apiFetch<ProductListResponse>(`/products${query ? `?${query}` : ''}`)

export const fetchProduct = (slug: string) => apiFetch<ProductDetailResponse>(`/products/${encodeURIComponent(slug)}`)

export const fetchFilters = () => apiFetch<FiltersResponse>('/filters')

/** The header's suggestions: the first few results of the same search the store runs. */
export interface SuggestionsResponse {
  data: ProductSummary[]
}

/** `signal` lets a request be abandoned when the visitor has typed something newer. */
export const fetchSuggestions = (term: string, signal?: AbortSignal) =>
  apiFetch<SuggestionsResponse>(`/search/suggestions?${new URLSearchParams({ q: term })}`, { signal })
