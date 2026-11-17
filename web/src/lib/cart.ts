/**
 * The cart. It lives in this browser's localStorage, so a visitor can fill
 * it without an account and find it again after a refresh.
 *
 * An item is one seller's OFFER, not a product: the buyer chose that seller
 * at that price. Adding the same offer again raises its quantity instead of
 * creating a second line.
 *
 * Nothing kept here is trusted. The names and the price are only what the
 * buyer was last shown; the cart page asks the server what the cart is
 * really worth (see checkout.ts, quoteCart) before anything is bought.
 */
import { useSyncExternalStore } from 'react'

export interface CartItem {
  offerId: number
  quantity: number
  /** The price the buyer was last shown. Sent back so a change is noticed. */
  unitPriceCents: number
  /** Only used to name the item if the server no longer knows the offer. */
  productName: string
  sellerName: string
}

const STORAGE_KEY = 'keymarket.cart.v1'

function isItem(value: unknown): value is CartItem {
  const item = value as CartItem
  return (
    typeof item === 'object' &&
    item !== null &&
    Number.isInteger(item.offerId) &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 1 &&
    Number.isInteger(item.unitPriceCents) &&
    typeof item.productName === 'string' &&
    typeof item.sellerName === 'string'
  )
}

/** Whatever is in storage, this returns a valid cart: damaged data means an empty one. */
function read(): CartItem[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter(isItem) : []
  } catch {
    return []
  }
}

let items = read()
const listeners = new Set<() => void>()

function save(next: CartItem[]) {
  items = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage is full or blocked: the cart still works until the page closes.
  }
  listeners.forEach((listener) => listener())
}

// Another tab changed the cart: show the same thing here.
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY || event.key === null) {
    items = read()
    listeners.forEach((listener) => listener())
  }
})

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The cart's items; the component re-renders whenever the cart changes. */
export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, () => items)
}

export const cart = {
  items: () => items,

  /** Add one of an offer, or one more if it is already in the cart. */
  add(item: Omit<CartItem, 'quantity'>) {
    const existing = items.find((entry) => entry.offerId === item.offerId)

    save(
      existing
        ? items.map((entry) => (entry === existing ? { ...entry, ...item, quantity: entry.quantity + 1 } : entry))
        : [...items, { ...item, quantity: 1 }],
    )
  },

  setQuantity(offerId: number, quantity: number) {
    save(items.map((entry) => (entry.offerId === offerId ? { ...entry, quantity: Math.max(1, quantity) } : entry)))
  },

  remove(offerId: number) {
    save(items.filter((entry) => entry.offerId !== offerId))
  },

  replace(next: CartItem[]) {
    save(next)
  },

  clear() {
    save([])
  },

  /** For tests: forget what is in memory and read storage again. */
  reload() {
    items = read()
    listeners.forEach((listener) => listener())
  },
}

/** How many keys the cart holds in total, for the header badge. */
export const cartCount = (cartItems: CartItem[]) => cartItems.reduce((total, item) => total + item.quantity, 0)

/*
 * One checkout attempt.
 *
 * Placing an order sends an Idempotency-Key. The same key is sent for every
 * repeat of the same cart (a double click, a retry after a lost response, a
 * refresh), so the server creates one order however many requests arrive.
 * A changed cart is a new attempt and gets a new key.
 */
const ATTEMPT_KEY = 'keymarket.checkout-attempt.v1'

interface Attempt {
  key: string
  /** Which cart the key belongs to. */
  cart: string
  /** The order the attempt created, once known. */
  orderId?: string
}

const describeCart = (cartItems: CartItem[]) =>
  JSON.stringify(
    [...cartItems].sort((a, b) => a.offerId - b.offerId).map((item) => [item.offerId, item.quantity, item.unitPriceCents]),
  )

function readAttempt(): Attempt | null {
  try {
    const stored = JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? 'null') as Attempt | null
    return stored && typeof stored.key === 'string' && typeof stored.cart === 'string' ? stored : null
  } catch {
    return null
  }
}

function saveAttempt(attempt: Attempt | null) {
  try {
    if (attempt) localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt))
    else localStorage.removeItem(ATTEMPT_KEY)
  } catch {
    // Without storage every click is a new attempt; the server still
    // gives up the earlier order when a new one starts.
  }
}

export const checkoutAttempt = {
  /** The key for this cart: the one already in use for it, or a new one. */
  keyFor(cartItems: CartItem[]): string {
    const current = readAttempt()
    const description = describeCart(cartItems)

    if (current?.cart === description) return current.key

    const key = crypto.randomUUID()
    saveAttempt({ key, cart: description })
    return key
  },

  /** Remember which order the current attempt became. */
  startedOrder(orderId: string) {
    const current = readAttempt()
    if (current) saveAttempt({ ...current, orderId })
  },

  orderId: () => readAttempt()?.orderId,

  /** The attempt is over (paid, declined, expired, cancelled): the next checkout is a new one. */
  forget() {
    saveAttempt(null)
  },
}
