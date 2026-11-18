/**
 * The account dashboard's totals (GET /api/account/summary). Counted by the
 * server from the buyer's own orders; never contains a key. The example
 * response in src/contracts is type-checked against this shape.
 */
import { apiFetch } from './api'

export interface AccountSummary {
  orders_count: number
  /** Orders whose payment succeeded and whose keys were delivered. */
  paid_orders_count: number
  /** Orders whose keys are held while payment is awaited (at most one). */
  pending_orders_count: number
  /** Keys delivered to this buyer. */
  keys_count: number
  spent: { total_cents: number; currency: string }
}

export interface AccountSummaryResponse {
  data: AccountSummary
}

/** Cached under the buyer's id, like their orders, and dropped with them (see forgetBuyer). */
export const summaryKey = (userId: number | null) => ['account', userId, 'summary']

export const fetchSummary = () => apiFetch<AccountSummaryResponse>('/account/summary')
