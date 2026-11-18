import { focusManager } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import summaryExample from '../contracts/account.summary.json'
import ordersExample from '../contracts/orders.list.json'
import paidExample from '../contracts/orders.paid.json'
import pendingExample from '../contracts/orders.pending.json'
import { renderAt, type SentRequest } from '../test/render'

/*
 * The account: signing in and up, the dashboard and its four sections, and
 * what happens to a buyer's orders and keys when the session ends.
 */

type Reply = { status?: number; body: unknown }
type User = { id: number; name: string; email: string }

const ada: User = { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' }
const noOrders = { data: [], meta: { current_page: 1, per_page: 10, total: 0, last_page: 1 } }
const nothingYet = { orders_count: 0, paid_orders_count: 0, pending_orders_count: 0, keys_count: 0, spent: { total_cents: 0, currency: 'EUR' } }

// The recorded examples mask their keys; these stand in for real ones.
const codes = ['ADA01-AAAAA-BBBBB', 'ADA02-AAAAA-BBBBB', 'ADA03-AAAAA-BBBBB']
let nextCode = 0
const paidOrder = {
  data: {
    ...paidExample.response.data,
    items: paidExample.response.data.items.map((item) => ({ ...item, keys: item.keys.map(() => codes[nextCode++ % codes.length]) })),
  },
}
const paidId = paidOrder.data.id
const [eldenRing, minecraft] = paidOrder.data.items
const paidOnly = { data: ordersExample.response.data.filter((order) => order.status === 'paid'), meta: { ...ordersExample.response.meta, total: 1 } }

const unauthenticated: Reply = { status: 401, body: { message: 'Unauthenticated.' } }

/**
 * A stand-in for the backend with a session. Ada has two orders (one paid,
 * one declined). A test replaces any reply, or changes who is signed in.
 */
function server(options: {
  user?: User | null
  me?: Reply | Promise<Reply>
  login?: (request: SentRequest) => Reply
  register?: (request: SentRequest) => Reply
  logout?: Reply
  summary?: Reply
  orders?: (query: URLSearchParams) => Reply
  order?: () => Reply
} = {}) {
  const state = { user: options.user === undefined ? ada : options.user, me: options.me, sent: [] as SentRequest[] }

  document.cookie = 'XSRF-TOKEN=token'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const request: SentRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname + url.search,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    }
    state.sent.push(request)
    const signedIn = state.user !== null

    const reply: Reply = await (async () => {
      switch (url.pathname) {
        case '/api/sanctum/csrf-cookie':
          return { body: {} }
        case '/api/auth/me':
          return state.me ?? { body: { data: state.user } }
        case '/api/auth/login': {
          const answer = options.login?.(request) ?? { body: { data: ada } }
          if ((answer.status ?? 200) < 300) state.user = (answer.body as { data: User }).data
          return answer
        }
        case '/api/auth/register': {
          const answer = options.register?.(request) ?? { status: 201, body: { data: ada } }
          if ((answer.status ?? 200) < 300) state.user = (answer.body as { data: User }).data
          return answer
        }
        case '/api/auth/logout': {
          const answer = options.logout ?? { body: {} }
          if ((answer.status ?? 200) < 300 || answer.status === 401) state.user = null
          return answer
        }
        case '/api/account/summary':
          return signedIn ? (options.summary ?? { body: summaryExample.response }) : unauthenticated
        case '/api/orders':
          if (!signedIn) return unauthenticated
          return options.orders?.(url.searchParams) ?? { body: url.searchParams.get('status') === 'paid' ? paidOnly : ordersExample.response }
        case `/api/orders/${paidId}`:
          return signedIn ? (options.order?.() ?? { body: paidOrder }) : unauthenticated
        default:
          return { status: 404, body: { message: 'Not found.' } }
      }
    })()

    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
  })

  return state
}

const requestsTo = (state: { sent: SentRequest[] }, prefix: string) => state.sent.filter((request) => request.path.startsWith(prefix))

function fillIn(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

/** The sign-in or sign-up form has appeared (the session check has answered). */
const formShown = () => screen.findByLabelText('Email')

/** The browser tab is looked at again: the app re-checks what it shows. */
function returnToTheTab() {
  focusManager.setFocused(false)
  focusManager.setFocused(true)
}

/** The number shown in a totals tile, found by its label. */
const tile = (label: string) => screen.getByText(label).parentElement?.querySelector('dd')?.textContent

afterEach(() => focusManager.setFocused(undefined))

describe('signing in', () => {
  it('asks a visitor to sign in where they are, keeps that place for signing up, and asks for none of their data', async () => {
    const api = server({ user: null })
    renderAt('/account/keys')

    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to see your game keys' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/account/register?next=%2Faccount%2Fkeys')
    expect(within(screen.getByRole('navigation', { name: 'Sign in or create an account' })).getByRole('link', { name: 'Sign in' })).toHaveAttribute('aria-current', 'page')
    expect(requestsTo(api, '/api/orders')).toEqual([])
    expect(requestsTo(api, '/api/account')).toEqual([])
  })

  it('explains what is missing or wrong before sending anything, and focuses it', async () => {
    const api = server({ user: null })
    renderAt('/account')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(screen.getByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter your email address.')
    expect(screen.getByLabelText('Email')).toHaveFocus()

    fillIn('Email', 'ada@')
    expect(screen.getByText('Enter an email address like name@example.com.')).toBeInTheDocument()
    fillIn('Email', 'ada@example.com')
    expect(screen.queryByText(/Enter an email address/)).not.toBeInTheDocument()

    expect(requestsTo(api, '/api/auth/login')).toEqual([])
  })

  it('shows and hides the password', async () => {
    server({ user: null })
    renderAt('/account')
    const password = await screen.findByLabelText('Password')
    const toggle = screen.getByRole('button', { name: 'Show password' })

    expect(password).toHaveAttribute('type', 'password')
    fireEvent.click(toggle)
    expect(password).toHaveAttribute('type', 'text')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(password).toHaveAttribute('type', 'password')
  })

  it('says, above the form, when the email and password do not match, and clears it once they are changed', async () => {
    server({
      user: null,
      login: () => ({ status: 422, body: { message: 'Invalid.', errors: { email: ['These credentials do not match our records.'] } } }),
    })
    renderAt('/account')
    await formShown()
    fillIn('Email', 'ada@example.com')
    fillIn('Password', 'wrong-password')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('These credentials do not match our records.')
    fillIn('Password', 'another-try')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("passes on the server's own words when there were too many attempts", async () => {
    server({ user: null, login: () => ({ status: 429, body: { message: 'Too many attempts. Try again in a minute.' } }) })
    renderAt('/account')
    await formShown()
    fillIn('Email', 'ada@example.com')
    fillIn('Password', 'a-test-password')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in a minute.')
  })

  it('shows that signing in is under way, and explains a failure that is not about the credentials', async () => {
    // The answer to signing in arrives when the test says so.
    let answer: (reply: Reply) => void = () => {}
    document.cookie = 'XSRF-TOKEN=token'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (path === '/api/auth/login') {
        const reply = await new Promise<Reply>((resolve) => (answer = resolve))
        return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
      }
      return new Response(JSON.stringify({ data: null }))
    })

    renderAt('/account')
    await formShown()
    fillIn('Email', 'ada@example.com')
    fillIn('Password', 'a-test-password')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled()
    expect(screen.getByLabelText('Password')).toHaveAttribute('readonly')

    answer({ status: 500, body: { message: 'Server Error' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('The server reported an error. Please try again in a moment.')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('opens the account in place once signed in, with the totals the server counted', async () => {
    const api = server({ user: null })
    renderAt('/account')
    await formShown()
    fillIn('Email', 'ada@example.com')
    fillIn('Password', 'a-test-password')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back, Ada' })).toBeInTheDocument()
    expect(api.sent.find((request) => request.path === '/api/auth/login')?.body).toEqual({ email: 'ada@example.com', password: 'a-test-password' })
    await waitFor(() => expect(tile('Total orders')).toBe('2'))
    expect(tile('Completed purchases')).toBe('1')
    expect(tile('Keys delivered')).toBe('3')
    expect(tile('Total spent')).toBe('€80.27')
  })

  it('returns to where the visitor was heading after they sign in', async () => {
    server({ user: null })
    const router = renderAt('/account?next=/cart')

    expect(await screen.findByText('Sign in or create an account to continue.')).toBeInTheDocument()
    fillIn('Email', 'ada@example.com')
    fillIn('Password', 'a-test-password')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/cart'))
  })

  it('never sends the visitor to another site after signing in', async () => {
    for (const next of ['https://evil.example/cart', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      server()
      const router = renderAt(`/account?next=${encodeURIComponent(next)}`)

      // Still the account: the address was not accepted as a destination.
      expect(await screen.findByRole('heading', { level: 1, name: /Welcome/ })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/account')
      cleanup()
    }
  })

  it('reports a real API failure instead of pretending the visitor is signed out', async () => {
    server({ me: { status: 500, body: { message: 'Server Error' } } })
    renderAt('/account')

    expect(await screen.findByRole('heading', { name: 'We could not check that you are signed in' })).toBeInTheDocument()
    // A server that answers "I failed" is not described as waking up.
    expect(screen.getByText('The server reported an error. Please try again in a moment.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('tells a visitor the server may be waking up when it does not answer, and lets them try again', async () => {
    let awake = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (!awake) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({ data: null }))
    })
    renderAt('/account')

    expect(await screen.findByRole('heading', { name: 'We could not check that you are signed in' })).toBeInTheDocument()
    expect(screen.getByText(/The server did not answer.*up to a minute/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()

    awake = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
  })

  it('asks the browser to offer the saved password when signing in and a new one when registering', async () => {
    server({ user: null })
    renderAt('/account')

    expect(await screen.findByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email')
    fireEvent.click(screen.getByRole('link', { name: 'Create an account' }))
    expect(await screen.findByLabelText('Name')).toHaveAttribute('autocomplete', 'name')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
  })

  it('shows nothing and asks for nothing while it is still checking who is signed in', async () => {
    const api = server({ me: new Promise<Reply>(() => {}) })
    renderAt('/account')

    expect(await screen.findByText('Checking that you are signed in…')).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(requestsTo(api, '/api/orders')).toEqual([])
    expect(requestsTo(api, '/api/account')).toEqual([])
  })
})

describe('creating an account', () => {
  it('checks the form by the server’s rules before sending it', async () => {
    const api = server({ user: null })
    renderAt('/account/register')
    fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))

    expect(screen.getByText('Enter your name.')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveFocus()

    fillIn('Name', 'Ada Lovelace')
    fillIn('Email', 'ada@example.com')
    fillIn('Password', 'short')
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByLabelText('Password')).toHaveFocus()

    expect(requestsTo(api, '/api/auth/register')).toEqual([])
  })

  it('creates the account and opens its dashboard, which says plainly that there is nothing in it yet', async () => {
    const api = server({ user: null, summary: { body: { data: nothingYet } }, orders: () => ({ body: noOrders }) })
    const router = renderAt('/account/register')
    await formShown()
    fillIn('Name', '  Ada Lovelace ')
    fillIn('Email', 'Ada@example.com')
    fillIn('Password', 'a-long-test-password')
    fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Ada' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/account')
    expect(api.sent.find((request) => request.path === '/api/auth/register')?.body).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'a-long-test-password',
    })
    expect(await screen.findByRole('heading', { name: 'No orders yet' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No keys yet' })).toBeInTheDocument()
    await waitFor(() => expect(tile('Total orders')).toBe('0'))
    expect(tile('Total spent')).toBe('€0.00')
  })

  it('shows what the server says about a field under that field', async () => {
    server({ user: null, register: () => ({ status: 422, body: { message: 'Invalid.', errors: { email: ['The email has already been taken.'] } } }) })
    renderAt('/account/register')
    await formShown()
    fillIn('Name', 'Ada Lovelace')
    fillIn('Email', 'ada@example.com')
    fillIn('Password', 'a-long-test-password')
    fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('The email has already been taken.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('sends someone who is already signed in on to their account', async () => {
    server()
    const router = renderAt('/account/register')

    await waitFor(() => expect(router.state.location.pathname).toBe('/account'))
  })
})

describe('the overview', () => {
  it('shows the latest orders, each linking to its page, and fetches no key until one is revealed', async () => {
    const api = server()
    renderAt('/account')

    const recent = within(await screen.findByRole('region', { name: 'Recent orders' }))
    const [declined, paid] = ordersExample.response.data
    expect(await recent.findByText('Payment declined')).toBeInTheDocument()
    expect(recent.getByText('Paid')).toBeInTheDocument()
    const orderLinks = recent.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/orders/'))
    expect(orderLinks.map((link) => link.getAttribute('href'))).toEqual([`/orders/${declined.id}`, `/orders/${paid.id}`])

    const keys = within(screen.getByRole('region', { name: 'Your game keys' }))
    expect(await keys.findAllByText('Hidden key')).toHaveLength(3)
    expect(requestsTo(api, `/api/orders/${paidId}`)).toEqual([])
    for (const code of codes) expect(screen.queryByText(code)).not.toBeInTheDocument()
  })

  it('offers to finish paying for an order that is awaiting payment', async () => {
    const pending = { ...pendingExample.response.data }
    server({ orders: () => ({ body: { data: [pending], meta: noOrders.meta } }) })
    renderAt('/account')

    expect(await screen.findByText(/is awaiting payment/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Complete payment' })).toHaveAttribute('href', `/orders/${pending.id}`)
  })

  it('says when the totals could not be loaded, without inventing any', async () => {
    server({ summary: { status: 500, body: { message: 'Server Error' } } })
    renderAt('/account')

    expect(await screen.findByText('Your account totals could not be loaded')).toBeInTheDocument()
    expect(screen.queryByText('Total orders')).not.toBeInTheDocument()
  })
})

describe('my orders', () => {
  it('lists the orders the API returns with status, payment, total and a link to each', async () => {
    server()
    renderAt('/account/orders')

    const [declined, paid] = ordersExample.response.data
    expect(await screen.findByRole('heading', { level: 1, name: 'My orders' })).toBeInTheDocument()
    const list = within(screen.getByRole('region', { name: 'Orders' }))
    expect(await list.findByText('Payment declined')).toBeInTheDocument()
    expect(list.getByText(/Payment: Charged/)).toBeInTheDocument()
    expect(list.getByText(/Payment: Declined, not charged · No keys were delivered\./)).toBeInTheDocument()
    expect(list.getByRole('link', { name: 'View keys' })).toHaveAttribute('href', `/orders/${paid.id}`)
    expect(list.getByRole('link', { name: 'View order' })).toHaveAttribute('href', `/orders/${declined.id}`)
    expect(list.getByText('€80.27')).toBeInTheDocument()
    expect(list.getAllByText(new RegExp(`Order #${declined.id.slice(0, 8).toUpperCase()}`))).toHaveLength(2)
    // The history never shows a key.
    for (const code of codes) expect(screen.queryByText(code)).not.toBeInTheDocument()
  })

  it('narrows the list to one state through the server, and says when there is nothing in it', async () => {
    const api = server({ orders: (query) => ({ body: query.get('status') === 'failed' ? noOrders : ordersExample.response }) })
    const router = renderAt('/account/orders')
    await screen.findByText('Payment declined')

    fireEvent.click(screen.getByRole('link', { name: 'Declined' }))

    expect(await screen.findByRole('heading', { name: 'No payment has been declined.' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?status=failed')
    expect(api.sent.some((request) => request.path === '/api/orders?page=1&status=failed')).toBe(true)
    expect(screen.getByRole('link', { name: 'Declined' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('link', { name: 'Show all orders' })).toHaveAttribute('href', '/account/orders')
  })

  it('keeps the page of the old order history address', async () => {
    const api = server()
    const router = renderAt('/orders?page=2')

    await waitFor(() => expect(router.state.location.pathname).toBe('/account/orders'))
    expect(router.state.location.search).toBe('?page=2')
    await waitFor(() => expect(api.sent.some((request) => request.path === '/api/orders?page=2')).toBe(true))
  })

  it('says so when there are no orders yet', async () => {
    server({ orders: () => ({ body: noOrders }) })
    renderAt('/account/orders')

    expect(await screen.findByRole('heading', { name: 'No orders yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the store' })).toHaveAttribute('href', '/store')
  })
})

describe('my game keys', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  function clipboard(writeText: (text: string) => Promise<void>) {
    const spy = vi.fn(writeText)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true })
    return spy
  }

  it('lists the delivered keys of paid orders only, each with its platform and region, all hidden', async () => {
    const api = server()
    renderAt('/account/keys')

    const card = await screen.findByRole('article', { name: eldenRing.product.name })
    const elden = within(card)
    expect(card).toHaveTextContent(`${eldenRing.product.platform.name} · ${eldenRing.product.region.name}`)
    expect(elden.getAllByText('Hidden key')).toHaveLength(eldenRing.quantity)
    expect(within(screen.getByRole('article', { name: minecraft.product.name })).getAllByText('Hidden key')).toHaveLength(minecraft.quantity)

    // Only paid orders were asked for, and no order with keys in it.
    expect(requestsTo(api, '/api/orders').map((request) => request.path)).toEqual(['/api/orders?page=1&status=paid'])
    for (const code of codes) expect(screen.queryByText(code)).not.toBeInTheDocument()
  })

  it('reveals the keys of one product only when asked, copies one, and hides them again', async () => {
    const api = server()
    const writeText = clipboard(async () => {})
    renderAt('/account/keys')

    fireEvent.click(await screen.findByRole('button', { name: `Reveal keys for ${eldenRing.product.name}` }))

    const elden = within(screen.getByRole('article', { name: eldenRing.product.name }))
    expect(await elden.findByText(eldenRing.keys[0])).toBeInTheDocument()
    expect(elden.getByText(eldenRing.keys[1])).toBeInTheDocument()
    expect(requestsTo(api, `/api/orders/${paidId}`)).toHaveLength(1)
    // The other product's key stays hidden, though the same answer carried it.
    expect(screen.queryByText(minecraft.keys[0])).not.toBeInTheDocument()

    fireEvent.click(elden.getByRole('button', { name: 'Copy key 2 of 2' }))
    expect(await elden.findByText('Copied to the clipboard.')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(eldenRing.keys[1])

    fireEvent.click(elden.getByRole('button', { name: `Hide keys for ${eldenRing.product.name}` }))
    expect(screen.queryByText(eldenRing.keys[0])).not.toBeInTheDocument()
    expect(elden.getAllByText('Hidden key')).toHaveLength(2)
  })

  it('says so when the key cannot be copied', async () => {
    server()
    clipboard(async () => {
      throw new DOMException('Denied', 'NotAllowedError')
    })
    renderAt('/account/keys')

    fireEvent.click(await screen.findByRole('button', { name: `Reveal key for ${minecraft.product.name}` }))
    fireEvent.click(await screen.findByRole('button', { name: 'Copy key' }))

    expect(await screen.findByText('Could not copy. Select the key and copy it by hand.')).toBeInTheDocument()
  })

  it('writes nothing it reveals to browser storage', async () => {
    server()
    renderAt('/account/keys')
    fireEvent.click(await screen.findByRole('button', { name: `Reveal keys for ${eldenRing.product.name}` }))
    await screen.findByText(eldenRing.keys[0])

    const stored = JSON.stringify({ ...localStorage, ...sessionStorage }) + document.cookie
    for (const code of codes) expect(stored).not.toContain(code)
  })

  it('reports keys that could not be loaded, and tries again', async () => {
    let failing = true
    server({ order: () => (failing ? { status: 500, body: { message: 'Server Error' } } : { body: paidOrder }) })
    renderAt('/account/keys')

    fireEvent.click(await screen.findByRole('button', { name: `Reveal key for ${minecraft.product.name}` }))
    expect(await screen.findByText(/Your key could not be loaded/)).toBeInTheDocument()
    expect(screen.queryByText(minecraft.keys[0])).not.toBeInTheDocument()

    failing = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(minecraft.keys[0])).toBeInTheDocument()
  })

  it('shows nothing when the server says the order is not this account’s', async () => {
    server({ order: () => ({ status: 404, body: { message: 'Order not found.' } }) })
    renderAt('/account/keys')

    fireEvent.click(await screen.findByRole('button', { name: `Reveal key for ${minecraft.product.name}` }))

    expect(await screen.findByText('This order is not available to the account that is signed in.')).toBeInTheDocument()
    for (const code of codes) expect(screen.queryByText(code)).not.toBeInTheDocument()
  })

  it('explains that an order awaiting payment has no keys yet', async () => {
    server({ summary: { body: { data: { ...summaryExample.response.data, pending_orders_count: 1 } } } })
    renderAt('/account/keys')

    expect(await screen.findByText(/An order is awaiting payment\. Its keys appear here once the payment is confirmed\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the order' })).toHaveAttribute('href', '/account/orders?status=pending')
  })

  it('has nothing to show a buyer with no paid orders, and says so', async () => {
    server({ orders: () => ({ body: noOrders }), summary: { body: { data: nothingYet } } })
    renderAt('/account/keys')

    expect(await screen.findByRole('heading', { name: 'No keys yet' })).toBeInTheDocument()
    expect(screen.queryByText(/awaiting payment/)).not.toBeInTheDocument()
  })
})

describe('profile', () => {
  it('shows the account as the server holds it, and offers no change the API cannot make', async () => {
    server()
    renderAt('/account/profile')

    const details = within(await screen.findByRole('region', { name: 'Account details' }))
    expect(details.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(details.getByText('ada@example.com')).toBeInTheDocument()
    expect(details.getByText('Changing your name, email address or password is not available yet.')).toBeInTheDocument()
    expect(within(screen.getByRole('main')).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('signs out from the profile, says so, and leaves nothing of the account on screen', async () => {
    const api = server()
    renderAt('/account/profile')
    await screen.findByRole('region', { name: 'Account details' })

    fireEvent.click(within(screen.getByRole('region', { name: 'Session' })).getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('You have signed out. Your orders and keys are no longer shown on this browser.')).toBeInTheDocument()
    expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument()
    expect(api.sent.some((request) => request.path === '/api/auth/logout' && request.method === 'POST')).toBe(true)
  })
})

describe('the session', () => {
  it('ends for the whole page when the server stops recognising it, and says why', async () => {
    const api = server()
    renderAt('/account/orders')
    await screen.findByRole('link', { name: 'View keys' })

    // The session ran out on the server. The next request is answered 401.
    api.user = null
    api.me = new Promise<Reply>(() => {})
    await act(async () => returnToTheTab())

    expect(await screen.findByText('Your session has ended. Sign in again to continue.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to see your orders' })).toBeInTheDocument()
    expect(screen.queryByText(/Order #/)).not.toBeInTheDocument()
    expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument()
  })

  it('treats a sign-out that finds the session already ended as signed out', async () => {
    server({ logout: unauthenticated })
    renderAt('/account')

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText(/You are still signed in/)).not.toBeInTheDocument()
  })

  it('says the buyer is still signed in when signing out fails', async () => {
    server({ logout: { status: 500, body: { message: 'Server Error' } } })
    renderAt('/account')

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('You are still signed in. The server reported an error. Please try again in a moment.')
    expect(screen.getByRole('heading', { level: 1, name: /Welcome/ })).toBeInTheDocument()
  })
})
