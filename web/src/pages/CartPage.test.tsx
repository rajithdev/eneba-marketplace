import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import quoteExample from '../contracts/cart.quote.json'
import pendingExample from '../contracts/orders.pending.json'
import declinedExample from '../contracts/orders.declined.json'
import { cart, type CartItem } from '../lib/cart'
import { mockApi, renderAt, type SentRequest } from '../test/render'

const [eldenLine, minecraftLine] = quoteExample.response.data.lines
const ELDEN = 101
const MINECRAFT = 102
const ada = { id: 1, name: 'Ada', email: 'ada@example.com' }

type SentItem = { offer_id: number; quantity: number; unit_price_cents: number }
type FakeOffer = { line: typeof eldenLine; price: number; stock: number }

/** What the server knows: prices and stock the browser cannot change. */
const catalog = (overrides: Record<number, Partial<FakeOffer>> = {}): Record<number, FakeOffer> => ({
  [ELDEN]: { line: eldenLine, price: 3149, stock: 6, ...overrides[ELDEN] },
  [MINECRAFT]: { line: minecraftLine, price: 1729, stock: 4, ...overrides[MINECRAFT] },
})

/** The same rules as the backend's QuoteCart, for the cases these tests use. */
function quoteFor(offers: Record<number, FakeOffer>, items: SentItem[]) {
  const lines = items.map((item) => {
    const offer = offers[item.offer_id]
    const buyable = Math.min(offer?.stock ?? 0, 10)
    const quantity = Math.min(item.quantity, buyable)
    const issues: string[] = []
    if (buyable === 0) issues.push('unavailable')
    else {
      if (quantity < item.quantity) issues.push(buyable === offer.stock ? 'insufficient_stock' : 'quantity_limited')
      if (item.unit_price_cents !== offer.price) issues.push('price_changed')
    }

    return {
      offer_id: item.offer_id,
      requested_quantity: item.quantity,
      quantity,
      max_quantity: buyable,
      // An offer the server has never heard of has no name, seller or price.
      product: offer?.line.product ?? null,
      seller: offer?.line.seller ?? null,
      unit_price: offer ? { amount_cents: offer.price, currency: 'EUR', original_amount_cents: null, discount_percent: null } : null,
      line_total_cents: (offer?.price ?? 0) * quantity,
      issues,
    }
  })
  const total = lines.reduce((sum, line) => sum + line.line_total_cents, 0)

  return {
    lines,
    totals: { items_count: lines.reduce((sum, line) => sum + line.quantity, 0), subtotal_cents: total, discount_cents: 0, total_cents: total, currency: 'EUR' },
    ok: lines.every((line) => line.issues.length === 0),
  }
}

function backend(options: {
  offers?: Record<number, FakeOffer>
  user?: typeof ada | null
  placeOrder?: (request: SentRequest, attempt: number) => { status?: number; body: unknown }
} = {}) {
  const offers = options.offers ?? catalog()
  const sent: SentRequest[] = []
  let attempts = 0

  mockApi((path, _query, request) => {
    sent.push(request)
    if (path === '/api/auth/me') return { body: { data: options.user ?? null } }
    if (path === '/api/cart/quote') return { body: { data: quoteFor(offers, (request.body as { items: SentItem[] }).items) } }
    if (path === '/api/orders' && request.method === 'POST') {
      return options.placeOrder?.(request, ++attempts) ?? { status: 201, body: pendingExample.response }
    }
    if (path.startsWith('/api/orders/')) return { body: pendingExample.response }
  })

  return {
    sent,
    quotes: () => sent.filter((request) => request.path === '/api/cart/quote').map((request) => (request.body as { items: SentItem[] }).items),
    orders: () => sent.filter((request) => request.path === '/api/orders' && request.method === 'POST'),
  }
}

function fillCart(...items: Partial<CartItem>[]) {
  cart.replace(items.map((item) => ({ offerId: ELDEN, quantity: 1, unitPriceCents: 3149, productName: 'Stored name', sellerName: 'Stored seller', ...item })))
}

const summary = () => within(screen.getByRole('region', { name: 'Order summary' }))
/** The amount on the summary's "Total" row. */
const total = () => summary().getByText('Total').parentElement

describe('cart page', () => {
  it('says so when the cart is empty, without asking the server', async () => {
    const { sent } = backend()
    renderAt('/cart')

    expect(await screen.findByRole('heading', { name: 'Your cart is empty' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the store' })).toHaveAttribute('href', '/store')
    expect(sent.filter((request) => request.path === '/api/cart/quote')).toHaveLength(0)
  })

  it('shows the names, sellers, prices and total the server gives, not what the browser stored', async () => {
    const { quotes } = backend()
    fillCart({ quantity: 2 }, { offerId: MINECRAFT, unitPriceCents: 1729 })
    renderAt('/cart')

    expect(await screen.findByRole('link', { name: eldenLine.product.name })).toHaveAttribute('href', `/product/${eldenLine.product.slug}`)
    expect(screen.getByRole('link', { name: minecraftLine.product.name })).toBeInTheDocument()
    expect(screen.queryByText('Stored name')).not.toBeInTheDocument()
    expect(screen.getAllByText(eldenLine.seller.name).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/97\.9% positive · 12,406 sales/).length).toBeGreaterThan(0)

    // 2 × 31.49 + 17.29
    expect(total()).toHaveTextContent('€80.27')
    expect(summary().getByText('3 keys')).toBeInTheDocument()
    // Only ids, quantities and the price last shown are sent.
    expect(quotes()[0]).toEqual([
      { offer_id: ELDEN, quantity: 2, unit_price_cents: 3149 },
      { offer_id: MINECRAFT, quantity: 1, unit_price_cents: 1729 },
    ])
  })

  it('reports a changed price and continues only after the buyer accepts it', async () => {
    backend({ offers: catalog({ [ELDEN]: { price: 3499 } }), user: ada })
    fillCart({ unitPriceCents: 3149 })
    renderAt('/cart')

    expect(await screen.findByText('The price changed from €31.49 to €34.99.')).toBeInTheDocument()
    // The total is already the real one, and checkout is not offered yet.
    expect(total()).toHaveTextContent('€34.99')
    expect(screen.queryByRole('button', { name: 'Proceed to checkout' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Update cart' }))

    expect(await screen.findByRole('button', { name: 'Proceed to checkout' })).toBeEnabled()
    expect(screen.queryByText(/The price changed/)).not.toBeInTheDocument()
    expect(cart.items()[0].unitPriceCents).toBe(3499)
  })

  it('cuts the quantity down to what is left in stock', async () => {
    backend({ offers: catalog({ [ELDEN]: { stock: 2 } }), user: ada })
    fillCart({ quantity: 5 })
    renderAt('/cart')

    expect(await screen.findByText('Only 2 left in stock: you asked for 5.')).toBeInTheDocument()
    expect(total()).toHaveTextContent('€62.98')

    fireEvent.click(screen.getByRole('button', { name: 'Update cart' }))

    await waitFor(() => expect(cart.items()[0].quantity).toBe(2))
    expect(await screen.findByRole('button', { name: 'Proceed to checkout' })).toBeInTheDocument()
    expect(screen.getByText('Maximum available')).toBeInTheDocument()
  })

  it('says when one order cannot hold that many', async () => {
    backend({ offers: catalog({ [ELDEN]: { stock: 40 } }) })
    fillCart({ quantity: 14 })
    renderAt('/cart')

    expect(await screen.findByText('One order can hold at most 10 of this offer.')).toBeInTheDocument()
  })

  it('removes an offer that is no longer available when the cart is updated', async () => {
    backend({ offers: catalog({ [MINECRAFT]: { stock: 0 } }), user: ada })
    fillCart({}, { offerId: MINECRAFT, unitPriceCents: 1729 })
    renderAt('/cart')

    expect(await screen.findByText(/This offer is no longer available/)).toBeInTheDocument()
    expect(screen.getByText('Not available')).toBeInTheDocument()
    // It is not counted in the total.
    expect(total()).toHaveTextContent('€31.49')

    fireEvent.click(screen.getByRole('button', { name: 'Update cart' }))

    await waitFor(() => expect(cart.items().map((item) => item.offerId)).toEqual([ELDEN]))
    expect(await screen.findByRole('button', { name: 'Proceed to checkout' })).toBeInTheDocument()
  })

  it('names an offer the server no longer knows by what the browser stored', async () => {
    backend({ offers: {} })
    fillCart({ offerId: 999, productName: 'A withdrawn game', sellerName: 'Gone Seller' })
    renderAt('/cart')

    expect(await screen.findByText(/This offer is no longer available/)).toBeInTheDocument()
    expect(screen.getByText('A withdrawn game')).toBeInTheDocument()
  })

  it('changes quantities within what is available and asks for a new quote each time', async () => {
    const { quotes } = backend({ offers: catalog({ [ELDEN]: { stock: 2 } }) })
    fillCart({})
    renderAt('/cart')
    const name = eldenLine.product.name

    const increase = await screen.findByRole('button', { name: `Increase quantity of ${name}` })
    await waitFor(() => expect(increase).toBeEnabled())
    expect(screen.getByRole('button', { name: `Decrease quantity of ${name}` })).toBeDisabled()

    fireEvent.click(increase)

    await waitFor(() => expect(total()).toHaveTextContent('€62.98'))
    expect(quotes().at(-1)).toEqual([{ offer_id: ELDEN, quantity: 2, unit_price_cents: 3149 }])
    // Two is all there is.
    expect(screen.getByRole('button', { name: `Increase quantity of ${name}` })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: `Decrease quantity of ${name}` }))
    await waitFor(() => expect(summary().getByText('1 key')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: `Remove ${name}` }))
    expect(await screen.findByRole('heading', { name: 'Your cart is empty' })).toBeInTheDocument()
  })

  it('asks a signed-out visitor to sign in, keeping the cart, and places no order', async () => {
    const { orders } = backend({ user: null })
    fillCart({})
    renderAt('/cart')

    expect(await screen.findByRole('link', { name: 'Sign in to check out' })).toHaveAttribute('href', '/account?next=/cart')
    expect(screen.queryByRole('button', { name: 'Proceed to checkout' })).not.toBeInTheDocument()
    expect(orders()).toHaveLength(0)
    expect(cart.items()).toHaveLength(1)
  })

  it('places the order with an idempotency key and opens the payment page', async () => {
    const { orders } = backend({ user: ada })
    fillCart({ quantity: 2 }, { offerId: MINECRAFT, unitPriceCents: 1729 })
    const router = renderAt('/cart')

    fireEvent.click(await screen.findByRole('button', { name: 'Proceed to checkout' }))

    expect(await screen.findByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/orders/${pendingExample.response.data.id}`)
    expect(orders()).toHaveLength(1)
    expect(orders()[0].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(orders()[0].body).toEqual({
      items: [
        { offer_id: ELDEN, quantity: 2, unit_price_cents: 3149 },
        { offer_id: MINECRAFT, quantity: 1, unit_price_cents: 1729 },
      ],
    })
    // Nothing is paid yet, so the cart is kept.
    expect(cart.items()).toHaveLength(2)
  })

  it('repeats a failed attempt with the same key, and uses a new key for a changed cart', async () => {
    const { orders } = backend({
      user: ada,
      placeOrder: (_request, attempt) => (attempt === 1 ? { status: 502, body: { message: 'Bad gateway' } } : { status: 409, body: { message: 'x', code: 'other' } }),
    })
    fillCart({})
    renderAt('/cart')

    fireEvent.click(await screen.findByRole('button', { name: 'Proceed to checkout' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Bad gateway')

    fireEvent.click(screen.getByRole('button', { name: 'Proceed to checkout' }))
    await waitFor(() => expect(orders()).toHaveLength(2))
    expect(orders()[1].headers['Idempotency-Key']).toBe(orders()[0].headers['Idempotency-Key'])

    fireEvent.click(screen.getByRole('button', { name: `Increase quantity of ${eldenLine.product.name}` }))
    await waitFor(() => expect(summary().getByText('2 keys')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Proceed to checkout' }))

    await waitFor(() => expect(orders()).toHaveLength(3))
    expect(orders()[2].headers['Idempotency-Key']).not.toBe(orders()[0].headers['Idempotency-Key'])
  })

  it('does not send a second order while the first is still being placed', async () => {
    let release = () => {}
    const { orders } = backend({ user: ada })
    fillCart({})
    renderAt('/cart')
    const button = await screen.findByRole('button', { name: 'Proceed to checkout' })
    await waitFor(() => expect(button).toBeEnabled())

    // Hold the order back, counting every attempt to send one.
    let sent = 0
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/orders') {
        sent++
        await new Promise<void>((resolve) => (release = resolve))
      }
      return realFetch(input, init)
    }) as typeof fetch

    // Two presses in the same instant, before the page can disable the button.
    act(() => {
      button.click()
      button.click()
    })
    expect(await screen.findByRole('button', { name: 'Reserving your keys…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reserving your keys…' }))
    release()

    expect(await screen.findByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument()
    expect(sent).toBe(1)
    expect(orders()).toHaveLength(1)
  })

  it('shows what changed when the server refuses the order because the cart is out of date', async () => {
    const offers = catalog()
    const { orders } = backend({
      offers,
      user: ada,
      placeOrder: (request) => {
        // Between the quote and the order, another buyer took all but one.
        offers[ELDEN].stock = 1
        return {
          status: 409,
          body: { message: 'Your cart has changed. Review the updated prices and availability.', code: 'cart_changed', quote: quoteFor(offers, (request.body as { items: SentItem[] }).items) },
        }
      },
    })
    fillCart({ quantity: 3 })
    renderAt('/cart')

    fireEvent.click(await screen.findByRole('button', { name: 'Proceed to checkout' }))

    expect(await screen.findByText('Only 1 left in stock: you asked for 3.')).toBeInTheDocument()
    expect(screen.getByText('Your cart has changed. Review the updated prices and availability.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update cart' })).toBeInTheDocument()
    expect(orders()).toHaveLength(1)
  })

  it('starts a new attempt when the key belongs to an order that already ended unpaid', async () => {
    const { orders } = backend({
      user: ada,
      // The first answer is the earlier, declined order for the same cart.
      placeOrder: (_request, attempt) => (attempt === 1 ? { status: 200, body: { data: declinedExample.response.data } } : { status: 201, body: pendingExample.response }),
    })
    fillCart({})
    renderAt('/cart')

    fireEvent.click(await screen.findByRole('button', { name: 'Proceed to checkout' }))

    expect(await screen.findByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument()
    expect(orders()).toHaveLength(2)
    expect(orders()[1].headers['Idempotency-Key']).not.toBe(orders()[0].headers['Idempotency-Key'])
  })

  it('shows the number of keys in the cart in the header', async () => {
    backend()
    fillCart({ quantity: 2 }, { offerId: MINECRAFT, unitPriceCents: 1729 })
    renderAt('/cart')

    expect(await screen.findByRole('link', { name: 'Cart, 3 items' })).toHaveAttribute('href', '/cart')
  })

  it('does not tell a buyer to sign in when it could not find out whether they are signed in', async () => {
    const sent: SentRequest[] = []
    let sessionWorks = false
    mockApi((path, _query, request) => {
      sent.push(request)
      if (path === '/api/auth/me') return sessionWorks ? { body: { data: ada } } : { status: 500, body: { message: 'Server Error' } }
      if (path === '/api/cart/quote') return { body: { data: quoteFor(catalog(), (request.body as { items: SentItem[] }).items) } }
    })
    fillCart({})
    renderAt('/cart')

    expect(await screen.findByText(/We could not check that you are signed in/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sign in to check out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Proceed to checkout' })).not.toBeInTheDocument()

    sessionWorks = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Proceed to checkout' })).toBeEnabled()
  })
})
