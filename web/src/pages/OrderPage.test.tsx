import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import declinedExample from '../contracts/orders.declined.json'
import ordersExample from '../contracts/orders.list.json'
import paidExample from '../contracts/orders.paid.json'
import pendingExample from '../contracts/orders.pending.json'
import { cart, checkoutAttempt } from '../lib/cart'
import { mockApi, renderAt, type SentRequest } from '../test/render'

const pending = pendingExample.response.data
// The recorded example masks its keys; give each one a distinct made-up
// value so the tests can tell them apart.
let keyNumber = 0
const paidResponse = {
  data: {
    ...paidExample.response.data,
    items: paidExample.response.data.items.map((item) => ({ ...item, keys: item.keys.map(() => `TEST${keyNumber++}-AAAAA-BBBBB`) })),
  },
}
const paid = paidResponse.data
const id = pending.id
const allKeys = paid.items.flatMap((item) => item.keys)

type Reply = { status?: number; body: unknown }

/** A stand-in server holding one order, whose state the test can change. */
function backend(options: { order?: Reply; pay?: (request: SentRequest) => Reply; cancel?: Reply } = {}) {
  const state = { order: options.order ?? { body: pendingExample.response } }
  const sent: SentRequest[] = []

  mockApi((path, _query, request) => {
    sent.push(request)
    if (path === `/api/orders/${id}/pay`) return options.pay?.(request) ?? { body: paidResponse }
    if (path === `/api/orders/${id}/cancel`) return options.cancel ?? { body: { data: { ...pending, status: 'cancelled', payment_methods: [], expires_at: null, expires_in_seconds: null } } }
    if (path === `/api/orders/${id}`) return state.order
    if (path === '/api/orders') return { body: ordersExample.response }
    if (path === '/api/auth/me') return { body: { data: { id: 1, name: 'Ada', email: 'ada@example.com' } } }
    if (path === '/api/cart/quote') return { status: 500, body: { message: 'not needed' } }
  })

  return { sent, state, payments: () => sent.filter((request) => request.path.endsWith('/pay')) }
}

/** As if this browser had just started the checkout for the order. */
function thisBrowserStartedTheCheckout() {
  cart.add({ offerId: 1, unitPriceCents: 3149, productName: 'Elden Ring', sellerName: 'Arcade Harbor' })
  checkoutAttempt.keyFor(cart.items())
  checkoutAttempt.startedOrder(id)
}

describe('an order awaiting payment', () => {
  it('shows what is being bought, the time left and the ways to pay from the API', async () => {
    backend()
    renderAt(`/orders/${id}`)

    expect(await screen.findByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent(/Your keys are held for (10:00|9:5\d)/)

    for (const method of pending.payment_methods) {
      expect(screen.getByRole('radio', { name: new RegExp(method.label) })).toBeInTheDocument()
      expect(screen.getByText(method.description)).toBeInTheDocument()
    }
    expect(screen.getByRole('radio', { name: /Test card ending 4242/ })).toBeChecked()

    for (const item of pending.items) {
      expect(screen.getByRole('link', { name: item.product.name })).toBeInTheDocument()
      expect(screen.getAllByText(item.seller_name).length).toBeGreaterThan(0)
    }
    expect(screen.getByRole('button', { name: 'Pay €80.27' })).toBeEnabled()
    // No key is on the page before payment.
    for (const key of allKeys) expect(screen.queryByText(key)).not.toBeInTheDocument()
    expect(screen.queryByText(/card number/i)).not.toBeInTheDocument()
  })

  it('pays with the chosen method, then shows the confirmation and the keys', async () => {
    const { payments } = backend()
    thisBrowserStartedTheCheckout()
    renderAt(`/orders/${id}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Pay €80.27' }))

    expect(await screen.findByRole('heading', { name: 'Payment confirmed' })).toBeInTheDocument()
    expect(payments()).toHaveLength(1)
    expect(payments()[0].body).toEqual({ payment_method: 'test_card_approved' })

    for (const item of paid.items) {
      const keys = within(screen.getByRole('list', { name: `Keys for ${item.product.name}` }))
      for (const key of item.keys) expect(keys.getByText(key)).toBeInTheDocument()
    }
    expect(screen.getByText('Test card ending 4242')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument()
    // The purchase is complete: the cart is emptied and the attempt is over.
    await waitFor(() => expect(cart.items()).toEqual([]))
    expect(checkoutAttempt.orderId()).toBeUndefined()
  })

  it('sends one payment however many times Pay is pressed', async () => {
    let release = () => {}
    const { payments } = backend()
    renderAt(`/orders/${id}`)
    const button = await screen.findByRole('button', { name: 'Pay €80.27' })

    // Hold the payment back, counting every attempt to send one.
    let sent = 0
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/pay')) {
        sent++
        await new Promise<void>((resolve) => (release = resolve))
      }
      return realFetch(input, init)
    }) as typeof fetch

    // Two presses in the same instant, before the page can disable the button...
    act(() => {
      button.click()
      button.click()
    })
    // ...and more while it is disabled.
    const processing = await screen.findByRole('button', { name: 'Processing payment…' })
    expect(processing).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel and return to cart' })).toBeDisabled()
    fireEvent.click(processing)
    release()

    expect(await screen.findByRole('heading', { name: 'Payment confirmed' })).toBeInTheDocument()
    expect(sent).toBe(1)
    expect(payments()).toHaveLength(1)
  })

  it('shows a declined payment as declined, with no keys, and keeps the cart', async () => {
    const declined = { ...declinedExample.response, data: { ...declinedExample.response.data, id } }
    const { payments } = backend({ pay: () => ({ status: 402, body: declined }) })
    thisBrowserStartedTheCheckout()
    renderAt(`/orders/${id}`)

    fireEvent.click(await screen.findByRole('radio', { name: /Test card ending 0002/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Pay €80.27' }))

    expect(await screen.findByRole('heading', { name: 'Payment declined' })).toBeInTheDocument()
    expect(payments()[0].body).toEqual({ payment_method: 'test_card_declined' })
    expect(screen.getByText(/The bank declined the card\. You have not been charged/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to cart' })).toHaveAttribute('href', '/cart')
    expect(screen.queryByRole('heading', { name: 'Your keys' })).not.toBeInTheDocument()
    expect(cart.items()).toHaveLength(1)
    // The next checkout of the same cart is a new attempt.
    await waitFor(() => expect(checkoutAttempt.orderId()).toBeUndefined())
  })

  it('shows an order that ran out of time as expired when paying comes too late', async () => {
    const expired = { message: 'This order can no longer be paid for. You have not been charged.', data: { ...pending, status: 'expired', expires_at: null, expires_in_seconds: null, payment_methods: [], payment: { status: 'cancelled', method: null } } }
    backend({ pay: () => ({ status: 409, body: expired }) })
    renderAt(`/orders/${id}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Pay €80.27' }))

    expect(await screen.findByRole('heading', { name: 'Order expired' })).toBeInTheDocument()
    expect(screen.getByText(/not paid for in time/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument()
  })

  it('asks the server when the countdown reaches zero and shows what it says', async () => {
    const { state } = backend({ order: { body: { data: { ...pending, expires_in_seconds: 1 } } } })
    renderAt(`/orders/${id}`)
    expect(await screen.findByRole('heading', { name: 'Complete your payment' })).toBeInTheDocument()

    // The server, not the page, is what expires the order.
    state.order = { body: { data: { ...pending, status: 'expired', expires_at: null, expires_in_seconds: null, payment_methods: [] } } }

    expect(await screen.findByRole('heading', { name: 'Order expired' }, { timeout: 4000 })).toBeInTheDocument()
  })

  it('says it is safe to try again when the answer to a payment is lost', async () => {
    backend({ pay: () => ({ status: 502, body: { message: 'Bad gateway' } }) })
    renderAt(`/orders/${id}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Pay €80.27' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('this order can only ever be charged once')
    expect(screen.getByRole('button', { name: 'Pay €80.27' })).toBeEnabled()
  })

  it('cancels the order and returns to the cart, which is kept', async () => {
    const { sent } = backend()
    thisBrowserStartedTheCheckout()
    const router = renderAt(`/orders/${id}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel and return to cart' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/cart'))
    expect(sent.some((request) => request.path === `/api/orders/${id}/cancel` && request.method === 'POST')).toBe(true)
    expect(cart.items()).toHaveLength(1)
  })

  it('shows the order as paid if cancelling comes after the charge went through', async () => {
    backend({ cancel: { body: paidResponse } })
    const router = renderAt(`/orders/${id}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel and return to cart' }))

    expect(await screen.findByRole('heading', { name: 'Payment confirmed' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/orders/${id}`)
  })
})

describe('a settled order', () => {
  it('shows the keys of a paid order after a refresh, and copies one on request', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    backend({ order: { body: paidResponse } })
    renderAt(`/orders/${id}`)

    expect(await screen.findByRole('heading', { name: 'Payment confirmed' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your keys' })).toBeInTheDocument()
    expect(screen.getByText('€80.27')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: `Copy key ${allKeys[0]}` }))

    expect(writeText).toHaveBeenCalledWith(allKeys[0])
    expect(await screen.findByRole('button', { name: `Copied key ${allKeys[0]}` })).toBeInTheDocument()
  })

  it('empties the cart when a refresh finds the checkout this browser started was paid', async () => {
    backend({ order: { body: paidResponse } })
    thisBrowserStartedTheCheckout()
    renderAt(`/orders/${id}`)

    await screen.findByRole('heading', { name: 'Payment confirmed' })

    await waitFor(() => expect(cart.items()).toEqual([]))
  })

  it('leaves the cart alone for an order this browser did not just start', async () => {
    backend({ order: { body: paidResponse } })
    cart.add({ offerId: 7, unitPriceCents: 500, productName: 'Something else', sellerName: 'Someone' })
    renderAt(`/orders/${id}`)

    await screen.findByRole('heading', { name: 'Payment confirmed' })

    expect(cart.items()).toHaveLength(1)
  })

  it('asks a signed-out visitor to sign in and come back', async () => {
    backend({ order: { status: 401, body: { message: 'Unauthenticated.' } } })
    renderAt(`/orders/${id}`)

    expect(await screen.findByRole('heading', { name: 'Sign in to see this order' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/account?next=/orders/${id}`)
  })

  it('says not found for an order that does not exist or is someone else’s', async () => {
    const { sent } = backend({ order: { status: 404, body: { message: 'Order not found.' } } })
    renderAt(`/orders/${id}`)

    expect(await screen.findByRole('heading', { name: 'Order not found' })).toBeInTheDocument()
    expect(sent.filter((request) => request.path === `/api/orders/${id}`)).toHaveLength(1)
  })
})
