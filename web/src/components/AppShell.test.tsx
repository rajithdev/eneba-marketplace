import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import filtersExample from '../contracts/filters.json'
import { createQueryClient } from '../lib/queryClient'
import { inShell } from '../routes'
import { mockApi, renderAt } from '../test/render'

const ada = { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' }

function api(options: { user?: typeof ada | null; filters?: { status?: number; body: unknown } } = {}) {
  return mockApi((path) => {
    if (path === '/api/auth/me') return { body: { data: options.user ?? null } }
    if (path === '/api/filters') return options.filters ?? { body: filtersExample.response }
  })
}

describe('the header and footer', () => {
  it('lists the product types the API reports as categories, linking to the store filtered by each', async () => {
    api()
    renderAt('/no-such-page')

    const categories = screen.getByRole('navigation', { name: 'Categories' })
    const sold = filtersExample.response.data.types.filter((type) => type.products_count > 0)
    expect(sold.length).toBeGreaterThan(1)

    for (const type of sold) {
      expect(await within(categories).findByRole('link', { name: type.label })).toHaveAttribute('href', `/store?type=${type.value}`)
    }
    // The same links again in the footer.
    const shop = screen.getByRole('navigation', { name: 'Shop' })
    expect(within(shop).getAllByRole('link').map((link) => link.textContent)).toEqual(['Store', ...sold.map((type) => type.label)])
  })

  it('leaves out a type with nothing to sell, and falls back to the store alone when the list cannot be loaded', async () => {
    api({ filters: { body: { data: { ...filtersExample.response.data, types: [{ value: 'game', label: 'Games', products_count: 3 }, { value: 'dlc', label: 'DLC', products_count: 0 }] } } } })
    renderAt('/no-such-page')
    const categories = screen.getByRole('navigation', { name: 'Categories' })
    await within(categories).findByRole('link', { name: 'Games' })
    expect(within(categories).queryByRole('link', { name: 'DLC' })).not.toBeInTheDocument()
  })

  it('shows only the store when the categories cannot be loaded', async () => {
    api({ filters: { status: 500, body: { message: 'Server Error' } } })
    renderAt('/no-such-page')

    await screen.findByRole('heading', { name: 'Page not found' })
    expect(within(screen.getByRole('navigation', { name: 'Categories' })).getAllByRole('link').map((link) => link.textContent)).toEqual(['Store'])
  })

  it('marks the category being browsed', async () => {
    api()
    renderAt('/store?type=game')

    const categories = screen.getByRole('navigation', { name: 'Categories' })
    expect(await within(categories).findByRole('link', { name: 'Games' })).toHaveAttribute('aria-current', 'page')
    expect(within(categories).getByRole('link', { name: 'Store' })).not.toHaveAttribute('aria-current')
  })

  it('offers a visitor the account page, and a signed-in buyer their name and their orders', async () => {
    api({ user: null })
    renderAt('/no-such-page')
    const main = screen.getByRole('navigation', { name: 'Main' })
    await screen.findByRole('link', { name: 'Sign in or register' })
    expect(within(main).getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account')
    expect(within(main).queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument()
  })

  it('shows a signed-in buyer their name and a link to their orders', async () => {
    api({ user: ada })
    renderAt('/no-such-page')
    const main = screen.getByRole('navigation', { name: 'Main' })

    expect(await within(main).findByRole('link', { name: 'Account, signed in as Ada Lovelace' })).toHaveTextContent('Ada Lovelace')
    expect(within(main).getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/orders')
  })
})

describe('a slow server', () => {
  afterEach(() => vi.useRealTimers())

  const notice = () => screen.queryByText(/Still waiting for the server/)

  it('is explained after a few seconds of waiting, and the explanation leaves with the answer', async () => {
    vi.useFakeTimers()
    const answers: (() => void)[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise((resolve) => answers.push(() => resolve(new Response(JSON.stringify({ data: null }))))),
    )
    renderAt('/no-such-page')

    await act(() => vi.advanceTimersByTimeAsync(3900))
    expect(notice()).not.toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(notice()).toBeInTheDocument()
    expect(notice()).toHaveAttribute('role', 'status')

    answers.forEach((answer) => answer())
    await act(() => vi.advanceTimersByTimeAsync(50))
    expect(notice()).not.toBeInTheDocument()
  })

  it('is not blamed when the server answers quickly, even with an error', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 }))
    renderAt('/account')

    // Long enough for every retry to have been made and answered.
    await act(() => vi.advanceTimersByTimeAsync(20_000))

    expect(notice()).not.toBeInTheDocument()
    expect(screen.getByText('The server reported an error. Please try again in a moment.')).toBeInTheDocument()
  })
})

describe('a page that fails while drawing itself', () => {
  function Broken(): never {
    throw new Error('a bug in this page')
  }

  it('is replaced by a message, with the header and navigation still around it', async () => {
    api()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const router = createMemoryRouter(inShell([{ path: '/', element: <Broken /> }]))

    render(
      <QueryClientProvider client={createQueryClient({ retryDelay: 0 })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Something went wrong on this page' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the homepage' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.queryByText(/a bug in this page/)).not.toBeInTheDocument()
  })
})
