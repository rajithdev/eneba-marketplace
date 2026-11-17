import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { expect, it, vi } from 'vitest'
import { createQueryClient } from '../lib/queryClient'
import { AccountPage } from './AccountPage'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function renderAccountPage(address = '/account') {
  const queryClient = createQueryClient({ retry: false })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[address]}>
        <Routes>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/cart" element={<p>The cart page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('shows the sign-in form to a visitor', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ data: null }))

  renderAccountPage()

  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument()
})

it('shows who is signed in and offers sign out', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    json({ data: { id: 1, name: 'Ada', email: 'ada@example.com' } }),
  )

  renderAccountPage()

  expect(await screen.findByText('ada@example.com')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
})

it('signs in and then shows the signed-in state', async () => {
  document.cookie = 'XSRF-TOKEN=token'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    url === '/api/auth/login'
      ? json({ data: { id: 1, name: 'Ada', email: 'ada@example.com' } })
      : json({ data: null }),
  )

  renderAccountPage()
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'ada@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByText('ada@example.com')).toBeInTheDocument()
})

it('shows the server validation message under the field', async () => {
  document.cookie = 'XSRF-TOKEN=token'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    url === '/api/auth/login'
      ? json({ message: 'Invalid.', errors: { email: ['These credentials do not match our records.'] } }, 422)
      : json({ data: null }),
  )

  renderAccountPage()
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'ada@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByText('These credentials do not match our records.')).toBeInTheDocument()
})

it('reports a real API failure instead of pretending the visitor is signed out', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ message: 'Server Error' }, 500))

  renderAccountPage()

  expect(await screen.findByRole('heading', { name: 'We could not check that you are signed in' })).toBeInTheDocument()
  // A server that answers "I failed" is not described as waking up.
  expect(screen.getByText('The server reported an error. Please try again in a moment.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
})

it('treats a sign-out that finds the session already ended as signed out', async () => {
  document.cookie = 'XSRF-TOKEN=token'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    url === '/api/auth/logout'
      ? json({ message: 'Unauthenticated.' }, 401)
      : json({ data: { id: 1, name: 'Ada', email: 'ada@example.com' } }),
  )

  renderAccountPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
})

it('returns to where the visitor was heading after they sign in', async () => {
  document.cookie = 'XSRF-TOKEN=token'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    url === '/api/auth/login' ? json({ data: { id: 1, name: 'Ada', email: 'ada@example.com' } }) : json({ data: null }),
  )

  renderAccountPage('/account?next=/cart')
  expect(await screen.findByText('Sign in or create an account to continue.')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByText('The cart page')).toBeInTheDocument()
})

it('never sends the visitor to another site after signing in', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ data: { id: 1, name: 'Ada', email: 'ada@example.com' } }))

  for (const next of ['https://evil.example/cart', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
    renderAccountPage(`/account?next=${encodeURIComponent(next)}`)

    // Still the account page: the address was not accepted as a destination.
    expect(await screen.findByText('ada@example.com')).toBeInTheDocument()
    cleanup()
  }
})

it('links a signed-in user to their orders', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ data: { id: 1, name: 'Ada', email: 'ada@example.com' } }))

  renderAccountPage()

  expect(await screen.findByRole('link', { name: 'Your orders and keys' })).toHaveAttribute('href', '/orders')
})

it('tells a visitor the server may be waking up when it does not answer, and lets them try again', async () => {
  let awake = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (!awake) throw new TypeError('Failed to fetch')
    return json({ data: null })
  })

  renderAccountPage()

  expect(await screen.findByRole('heading', { name: 'We could not check that you are signed in' })).toBeInTheDocument()
  expect(screen.getByText(/The server did not answer.*up to a minute/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()

  awake = true
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByLabelText('Email')).toBeInTheDocument()
})

it('shows that signing in is under way, and explains a failure that is not about the credentials', async () => {
  document.cookie = 'XSRF-TOKEN=token'
  let answer: (response: Response) => void = () => {}
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    url === '/api/auth/login' ? new Promise<Response>((resolve) => (answer = resolve)) : json({ data: null }),
  )

  renderAccountPage()
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'ada@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-test-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled()

  answer(json({ message: 'Server Error' }, 500))
  expect(await screen.findByRole('alert')).toHaveTextContent('The server reported an error. Please try again in a moment.')
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
})

it('asks the browser to offer a new password when registering and the saved one when signing in', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ data: null }))
  renderAccountPage()

  expect(await screen.findByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  fireEvent.click(screen.getByRole('button', { name: 'New here? Create an account' }))
  expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
  expect(screen.getByLabelText('Name')).toHaveAttribute('autocomplete', 'name')
})
