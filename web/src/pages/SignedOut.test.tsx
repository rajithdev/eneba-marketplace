import { focusManager } from '@tanstack/react-query'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ordersExample from '../contracts/orders.list.json'
import paidExample from '../contracts/orders.paid.json'
import { cart, checkoutAttempt } from '../lib/cart'
import { renderAt } from '../test/render'

/*
 * A buyer's orders and keys must never be on screen for anyone but that
 * buyer: not after signing out, not when the browser's Back button returns
 * to a page that showed them, not while it is unknown who is signed in, and
 * not for the next person to sign in on the same browser.
 */

const ada = { id: 1, name: 'Ada', email: 'ada@example.com' }
const ben = { id: 2, name: 'Ben', email: 'ben@example.com' }

// The recorded example masks its keys; these stand in for Ada's real ones.
const adasKeys = ['ADAS1-AAAAA-BBBBB', 'ADAS2-AAAAA-BBBBB', 'ADAS3-AAAAA-BBBBB']
let next = 0
const adasPaidOrder = {
  data: {
    ...paidExample.response.data,
    items: paidExample.response.data.items.map((item) => ({ ...item, keys: item.keys.map(() => adasKeys[next++ % adasKeys.length]) })),
  },
}
const orderId = adasPaidOrder.data.id
const shownKeys = adasPaidOrder.data.items.flatMap((item) => item.keys)
const noOrders = { data: [], meta: { current_page: 1, per_page: 10, total: 0, last_page: 1 } }

type Reply = { status?: number; body: unknown }

/**
 * A stand-in server with a session. Ada has orders; Ben has none. A test
 * changes `signedIn`, or replaces a reply (also with one that arrives
 * later, to look at the page while it waits).
 */
function server(signedIn: typeof ada | null) {
  const state = {
    signedIn,
    me: undefined as Reply | Promise<Reply> | undefined,
    orders: undefined as Reply | Promise<Reply> | undefined,
    requested: [] as string[],
  }
  const unauthenticated: Reply = { status: 401, body: { message: 'Unauthenticated.' } }

  document.cookie = 'XSRF-TOKEN=token'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname
    state.requested.push(path)

    const reply = await (() => {
      if (path === '/api/auth/me') return state.me ?? { body: { data: state.signedIn } }
      if (path === '/api/auth/logout') {
        state.signedIn = null
        return { body: {} }
      }
      if (path === '/api/auth/login') {
        state.signedIn = ben
        return { body: { data: ben } }
      }
      if (path === '/api/orders') return state.orders ?? (state.signedIn === ada ? { body: ordersExample.response } : state.signedIn ? { body: noOrders } : unauthenticated)
      if (path === `/api/orders/${orderId}`) return state.signedIn === ada ? { body: adasPaidOrder } : state.signedIn ? { status: 404, body: { message: 'Order not found.' } } : unauthenticated
      return { status: 404, body: { message: 'Not found.' } }
    })()

    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
  })

  return state
}

/** The browser tab is looked at again: the app re-checks what it shows. */
function returnToTheTab() {
  focusManager.setFocused(false)
  focusManager.setFocused(true)
}

function expectNothingOfAdas() {
  for (const key of shownKeys) expect(screen.queryByText(key)).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'View keys' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Order #/)).not.toBeInTheDocument()
}

async function signOut(router: ReturnType<typeof renderAt>) {
  await router.navigate('/account')
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
  await screen.findByRole('button', { name: 'Sign in' })
}

afterEach(() => focusManager.setFocused(undefined))

it('shows no order or key of the previous buyer when Back returns to them after signing out', async () => {
  const api = server(ada)
  const router = renderAt('/orders')
  await screen.findByRole('link', { name: 'View keys' })
  await router.navigate(`/orders/${orderId}`)
  await screen.findByText(shownKeys[0])

  await signOut(router)
  const requestedBefore = api.requested.length

  // Back to the order that showed the keys...
  await router.navigate(-1)
  expect(await screen.findByRole('heading', { name: 'Sign in to see this order' })).toBeInTheDocument()
  expectNothingOfAdas()

  // ...and back again to the order history.
  await router.navigate(-1)
  expect(await screen.findByRole('heading', { name: 'Sign in to see your orders' })).toBeInTheDocument()
  expectNothingOfAdas()

  // Nothing was even asked for on the visitor's behalf.
  expect(api.requested.slice(requestedBefore).filter((path) => path.startsWith('/api/orders'))).toEqual([])
})

it('forgets the checkout in progress on signing out, and keeps the cart', async () => {
  server(ada)
  cart.add({ offerId: 1, unitPriceCents: 3149, productName: 'Elden Ring', sellerName: 'Arcade Harbor' })
  checkoutAttempt.keyFor(cart.items())
  checkoutAttempt.startedOrder(orderId)

  await signOut(renderAt('/account'))

  expect(checkoutAttempt.orderId()).toBeUndefined()
  expect(cart.items()).toHaveLength(1)
})

it('asks for and shows nothing while it is still checking who is signed in', async () => {
  const api = server(ada)
  let answer: (reply: Reply) => void = () => {}
  api.me = new Promise<Reply>((resolve) => (answer = resolve))

  renderAt(`/orders/${orderId}`)

  expect(await screen.findByText('Checking that you are signed in…')).toBeInTheDocument()
  expect(api.requested.filter((path) => path.startsWith('/api/orders'))).toEqual([])

  // Only once the server has said who it is does the order appear.
  answer({ body: { data: ada } })
  expect(await screen.findByText(shownKeys[0])).toBeInTheDocument()
})

it('shows no orders when the session check fails, and does not call that signed out', async () => {
  const api = server(ada)
  api.me = { status: 500, body: { message: 'Server Error' } }

  renderAt('/orders')

  expect(await screen.findByRole('heading', { name: 'We could not check that you are signed in' })).toBeInTheDocument()
  expect(screen.getByText('The server reported an error. Please try again in a moment.')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /Sign in to see/ })).not.toBeInTheDocument()
  expect(api.requested.filter((path) => path.startsWith('/api/orders'))).toEqual([])

  // When the check works again, so does the page.
  api.me = undefined
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('link', { name: 'View keys' })).toBeInTheDocument()
})

it('takes keys off the screen when a later session check fails', async () => {
  const api = server(ada)
  renderAt(`/orders/${orderId}`)
  await screen.findByText(shownKeys[0])

  // It is no longer known that Ada is the one looking at this tab.
  api.me = { status: 500, body: { message: 'Server Error' } }
  returnToTheTab()

  expect(await screen.findByRole('heading', { name: 'We could not check that you are signed in' })).toBeInTheDocument()
  expectNothingOfAdas()
})

it('drops everything of the buyer as soon as any request answers "not signed in"', async () => {
  const api = server(ada)
  renderAt('/orders')
  await screen.findByRole('link', { name: 'View keys' })

  // The session ended elsewhere (another tab, or it ran out). Here the
  // server still believes "who am I" is slow to answer, so the first thing
  // this tab hears is the 401 for its orders.
  api.signedIn = null
  api.me = new Promise<Reply>(() => {})
  returnToTheTab()

  expect(await screen.findByRole('heading', { name: 'Sign in to see your orders' })).toBeInTheDocument()
  expectNothingOfAdas()
})

it('never shows one account the orders of the account that used the browser before it', async () => {
  const api = server(ada)
  const router = renderAt('/orders')
  await screen.findByRole('link', { name: 'View keys' })

  await signOut(router)
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: ben.email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-test-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByText(ben.email)

  // Ben opens his orders. While the answer is on its way, nothing of
  // Ada's fills the gap.
  let answer: (reply: Reply) => void = () => {}
  api.orders = new Promise<Reply>((resolve) => (answer = resolve))
  await router.navigate('/orders')
  expect(await screen.findByText('Loading your orders…')).toBeInTheDocument()
  expectNothingOfAdas()

  answer({ body: noOrders })
  expect(await screen.findByRole('heading', { name: 'No orders yet' })).toBeInTheDocument()
  expectNothingOfAdas()

  // And Ada's order page, reached by Back or a saved address, is not his.
  api.orders = undefined
  await router.navigate(`/orders/${orderId}`)
  expect(await screen.findByRole('heading', { name: 'Order not found' })).toBeInTheDocument()
  await waitFor(expectNothingOfAdas)
})
