import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { AccountPage } from './AccountPage'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

function renderAccountPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AccountPage />
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

  expect(await screen.findByText('The API is not reachable.')).toBeInTheDocument()
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
