import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import { shouldRetry } from '../lib/api'
import { routes } from '../routes'

/**
 * Renders the whole app at an address, with the real routes and shell, and
 * returns the router so a test can read the current address back.
 */
export function renderAt(address: string) {
  const router = createMemoryRouter(routes, { initialEntries: [address] })
  const queryClient = new QueryClient({
    defaultOptions: {
      // The app's own retry rule, without the waiting between attempts.
      queries: { retry: shouldRetry, retryDelay: 0 },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return router
}

type Reply = { status?: number; body: unknown }

/**
 * Stands in for the backend. `respond` gets the path and query of each
 * request and returns what the API would. Returns the list of requested
 * addresses, in order.
 */
export function mockApi(respond: (path: string, query: URLSearchParams) => Reply | undefined) {
  const requested: string[] = []

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost')
    requested.push(url.pathname + url.search)
    const reply = respond(url.pathname, url.searchParams) ?? { status: 404, body: { message: 'Not found.' } }

    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
  })

  return requested
}
