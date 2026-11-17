/**
 * The cart and order API: the shape of each response, and the functions
 * that call it. As with the catalog, the example responses in src/contracts
 * are type-checked against these shapes (see contracts.test.ts).
 */
import { apiFetch } from './api'
import type { CartItem } from './cart'
import type { Money, NamedOption } from './catalog'

/** What can be wrong with a cart line. */
export type CartIssue = 'unavailable' | 'insufficient_stock' | 'quantity_limited' | 'price_changed'

export interface Totals {
  items_count: number
  /** Before discounts. */
  subtotal_cents: number
  discount_cents: number
  /** What is paid. */
  total_cents: number
  currency: string
}

interface LineProduct {
  slug: string
  name: string
  cover_image_url: string | null
  platform: NamedOption
  region: NamedOption
}

export interface QuoteLine {
  offer_id: number
  requested_quantity: number
  /** What can be bought right now: 0 when the offer is unavailable. */
  quantity: number
  /** The most one order may hold of this offer right now. */
  max_quantity: number
  /** null when the server does not know the offer at all. */
  product: LineProduct | null
  seller: { slug: string; name: string; rating_percent: number; sales_count: number } | null
  unit_price: Money | null
  line_total_cents: number
  issues: string[]
}

export interface Quote {
  lines: QuoteLine[]
  totals: Totals
  /** True when the cart can be bought exactly as it was sent. */
  ok: boolean
}

export interface QuoteResponse {
  data: Quote
}

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled'

export interface OrderItemSummary {
  offer_id: number
  product: LineProduct
  seller_name: string
  unit_price: Money
  quantity: number
  line_total_cents: number
}

export interface OrderItem extends OrderItemSummary {
  /** The license keys. Empty until the order is paid. */
  keys: string[]
}

interface OrderBase {
  id: string
  /** One of OrderStatus. */
  status: string
  created_at: string
  paid_at: string | null
  /** While pending: until when the keys are held, and how long that is from now. */
  expires_at: string | null
  expires_in_seconds: number | null
  /** Why the payment was declined, when it was. */
  failure_reason: string | null
  totals: Totals
  payment: { status: string; method: string | null }
}

/** An order in the order history: no keys. */
export interface OrderSummary extends OrderBase {
  items: OrderItemSummary[]
}

export interface PaymentMethod {
  value: string
  label: string
  description: string
}

/** One order in full. */
export interface Order extends OrderBase {
  items: OrderItem[]
  /** The ways to pay, while the order awaits payment. */
  payment_methods: PaymentMethod[]
}

/** Also the body of a declined (402) or no-longer-payable (409) payment, with a message. */
export interface OrderResponse {
  message?: string
  data: Order
}

export interface OrderListResponse {
  data: OrderSummary[]
  meta: { current_page: number; per_page: number; total: number; last_page: number }
}

/** The body of the 409 answer when an order cannot be placed as the cart was sent. */
export interface CartChangedResponse {
  message: string
  code: string
  quote: Quote
}

const asRequestItems = (items: CartItem[]) =>
  items.map((item) => ({ offer_id: item.offerId, quantity: item.quantity, unit_price_cents: item.unitPriceCents }))

/** Ask the server what the cart is worth right now. Works for guests. */
export const quoteCart = (items: CartItem[], signal?: AbortSignal) =>
  apiFetch<QuoteResponse>('/cart/quote', { method: 'POST', body: JSON.stringify({ items: asRequestItems(items) }), signal })

/** Hold the keys and create a pending order. Repeating it with the same key returns the same order. */
export const placeOrder = (items: CartItem[], idempotencyKey: string) =>
  apiFetch<OrderResponse>('/orders', {
    method: 'POST',
    body: JSON.stringify({ items: asRequestItems(items) }),
    headers: { 'Idempotency-Key': idempotencyKey },
  })

export const fetchOrder = (id: string) => apiFetch<OrderResponse>(`/orders/${encodeURIComponent(id)}`)

export const fetchOrders = (page: number) => apiFetch<OrderListResponse>(`/orders?page=${page}`)

export const payOrder = (id: string, paymentMethod: string) =>
  apiFetch<OrderResponse>(`/orders/${encodeURIComponent(id)}/pay`, {
    method: 'POST',
    body: JSON.stringify({ payment_method: paymentMethod }),
  })

export const cancelOrder = (id: string) => apiFetch<OrderResponse>(`/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' })

/** Tells the 409 "cart changed" body apart from any other error body. */
export function isCartChanged(body: unknown): body is CartChangedResponse {
  return typeof body === 'object' && body !== null && (body as CartChangedResponse).code === 'cart_changed' && 'quote' in body
}

/** Tells an order body (also sent with a declined or refused payment) apart from any other. */
export function hasOrder(body: unknown): body is OrderResponse {
  const data = (body as OrderResponse | null)?.data
  return typeof data === 'object' && data !== null && typeof data.id === 'string' && typeof data.status === 'string'
}

/**
 * The cart as the server says it can be bought: current prices, quantities
 * cut down to what is available, and lines that cannot be bought removed.
 * A cart reconciled like this gets a quote with nothing wrong in it.
 */
export function reconcile(items: CartItem[], quote: Quote): CartItem[] {
  return items.flatMap((item) => {
    const line = quote.lines.find((candidate) => candidate.offer_id === item.offerId)

    if (!line || line.quantity === 0 || !line.unit_price || !line.product || !line.seller) return []

    return [
      {
        offerId: item.offerId,
        quantity: line.quantity,
        unitPriceCents: line.unit_price.amount_cents,
        productName: line.product.name,
        sellerName: line.seller.name,
      },
    ]
  })
}

/** How each order status is worded for the buyer. */
export const statusLabels: Record<string, string> = {
  pending: 'Awaiting payment',
  paid: 'Paid',
  failed: 'Payment declined',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

/** The first block of the order's long random id is enough to recognise it by. */
export const shortId = (id: string) => `#${id.slice(0, 8).toUpperCase()}`
