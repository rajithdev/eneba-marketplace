import { describe, expect, it } from 'vitest'
import quoteExample from '../contracts/cart.quote.json'
import { cart, cartCount, checkoutAttempt, type CartItem } from './cart'
import { reconcile } from './checkout'

const elden = { offerId: 11, unitPriceCents: 3149, productName: 'Elden Ring Steam Key GLOBAL', sellerName: 'Arcade Harbor' }
const sameGameOtherSeller = { ...elden, offerId: 12, unitPriceCents: 3300, sellerName: 'KeyHive' }

describe('the cart', () => {
  it('treats a seller offer, not a product, as the item', () => {
    cart.add(elden)
    cart.add(sameGameOtherSeller)

    expect(cart.items().map((item) => [item.offerId, item.sellerName, item.quantity])).toEqual([
      [11, 'Arcade Harbor', 1],
      [12, 'KeyHive', 1],
    ])
  })

  it('raises the quantity when the same offer is added again instead of duplicating it', () => {
    cart.add(elden)
    cart.add(elden)
    cart.add(elden)

    expect(cart.items()).toHaveLength(1)
    expect(cart.items()[0].quantity).toBe(3)
    expect(cartCount(cart.items())).toBe(3)
  })

  it('survives a page reload', () => {
    cart.add(elden)
    cart.setQuantity(11, 4)

    cart.reload()

    expect(cart.items()).toEqual([{ ...elden, quantity: 4 }])
  })

  it('never lets a quantity drop below one, and removes only on request', () => {
    cart.add(elden)
    cart.setQuantity(11, 0)
    expect(cart.items()[0].quantity).toBe(1)

    cart.remove(11)
    expect(cart.items()).toEqual([])
  })

  it('starts empty when what is stored is damaged or not a cart', () => {
    for (const stored of ['{not json', '"a string"', '[{"offerId":"x"}]', '[{"offerId":1,"quantity":-3,"unitPriceCents":100,"productName":"a","sellerName":"b"}]']) {
      localStorage.setItem('keymarket.cart.v1', stored)
      cart.reload()

      expect(cart.items()).toEqual([])
    }
  })
})

describe('a checkout attempt', () => {
  const items: CartItem[] = [{ ...elden, quantity: 2 }]

  it('uses one key for every repeat of the same cart', () => {
    const key = checkoutAttempt.keyFor(items)

    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(checkoutAttempt.keyFor(items)).toBe(key)
    // The order of the lines does not make it a different cart.
    const two = [...items, { ...sameGameOtherSeller, quantity: 1 }]
    expect(checkoutAttempt.keyFor([...two].reverse())).toBe(checkoutAttempt.keyFor(two))
  })

  it('uses a new key when the quantity, the price or the items change', () => {
    const key = checkoutAttempt.keyFor(items)

    expect(checkoutAttempt.keyFor([{ ...elden, quantity: 3 }])).not.toBe(key)
    expect(checkoutAttempt.keyFor([{ ...elden, quantity: 2, unitPriceCents: 3000 }])).not.toBe(key)
    expect(checkoutAttempt.keyFor([...items, { ...sameGameOtherSeller, quantity: 1 }])).not.toBe(key)
  })

  it('uses a new key once the attempt is over', () => {
    const key = checkoutAttempt.keyFor(items)
    checkoutAttempt.startedOrder('order-1')
    expect(checkoutAttempt.orderId()).toBe('order-1')

    checkoutAttempt.forget()

    expect(checkoutAttempt.orderId()).toBeUndefined()
    expect(checkoutAttempt.keyFor(items)).not.toBe(key)
  })
})

describe('reconciling the cart with a quote', () => {
  const quote = quoteExample.response.data
  const [first, second] = quote.lines

  it('adopts the server prices and quantities and drops what cannot be bought', () => {
    const mine: CartItem[] = [
      { offerId: first.offer_id, quantity: 5, unitPriceCents: 1, productName: 'old name', sellerName: 'old seller' },
      { offerId: second.offer_id, quantity: 1, unitPriceCents: second.unit_price.amount_cents, productName: 'x', sellerName: 'y' },
      { offerId: 999, quantity: 1, unitPriceCents: 100, productName: 'gone', sellerName: 'gone' },
    ]

    expect(reconcile(mine, { ...quote, lines: [{ ...first, quantity: 2 }, { ...second, quantity: 0, issues: ['unavailable'] }] })).toEqual([
      {
        offerId: first.offer_id,
        quantity: 2,
        unitPriceCents: first.unit_price.amount_cents,
        productName: first.product.name,
        sellerName: first.seller.name,
      },
    ])
  })
})
