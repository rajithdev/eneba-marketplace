/**
 * The homepage API. The backend decides which blocks the homepage has, in
 * what order, with what title and content; this file only describes the
 * shape of that answer. The example in src/contracts/homepage.json is
 * type-checked against it (see contracts.test.ts).
 */
import { apiFetch } from './api'
import type { ProductSummary } from './catalog'

export interface Banner {
  title: string
  subtitle: string | null
  /** Artwork served by this site, or null. */
  image_url: string | null
  /** Always a path inside this site. */
  link_url: string
  cta_label: string | null
}

export interface HomepageBlock {
  id: number
  /** Which kind of block this is: decides which component draws it. */
  type: string
  title: string | null
  /** An optional "see more" link, to a path inside this site. */
  link: { label: string; url: string } | null
  /** Banners for a hero block, products for a product block. */
  data: { banners?: Banner[]; products?: ProductSummary[] }
}

export interface HomepageResponse {
  data: { blocks: HomepageBlock[] }
}

export const fetchHomepage = () => apiFetch<HomepageResponse>('/homepage')
