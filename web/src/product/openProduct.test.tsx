import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import filtersExample from '../contracts/filters.json'
import listExample from '../contracts/products.list.json'
import showExample from '../contracts/products.show.json'
import { createQueryClient } from '../lib/queryClient'
import { routes } from '../routes'
import { mockApi } from '../test/render'
import { COVER_NAME } from './openProduct'

const card = listExample.response.data[0]

function storeApi() {
  return mockApi((path) => {
    if (path === '/api/filters') return { body: filtersExample.response }
    if (path === '/api/products') return { body: listExample.response }
    if (path === `/api/products/${card.slug}`) return { body: { data: { ...showExample.response.data, slug: card.slug, name: card.name } } }
  })
}

/*
 * jsdom has neither View Transitions nor media queries. Stand-ins: a
 * startViewTransition that runs the page change at once and remembers what
 * was named at the moment it was called (that is when a browser takes its
 * picture of the old page), and a matchMedia answering for reduced motion.
 */
let namedAtStart: string[] = []
const startViewTransition = vi.fn((update: (() => unknown) | { update: () => unknown }) => {
  namedAtStart = [...document.querySelectorAll<HTMLElement>('*')]
    .filter((element) => element.style.getPropertyValue('view-transition-name') === COVER_NAME)
    .map((element) => element.className)
  const done = Promise.resolve().then(() => (typeof update === 'function' ? update() : update.update()))
  return { ready: done, finished: done, updateCallbackDone: done, skipTransition: () => {} }
})

function browser({ reducedMotion }: { reducedMotion: boolean }) {
  Object.assign(document, { startViewTransition })
  window.matchMedia = ((query: string) => ({
    matches: reducedMotion && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  startViewTransition.mockClear()
  namedAtStart = []
})

afterEach(() => {
  delete (document as Partial<Document> & { startViewTransition?: unknown }).startViewTransition
  // @ts-expect-error: jsdom has no matchMedia of its own; the stand-in is removed again.
  delete window.matchMedia
  window.history.replaceState(null, '', '/')
})

/**
 * The app as it runs in a browser: React Router only uses View Transitions
 * with a browser router (the test helper's memory router has no window).
 */
function openStore() {
  window.history.replaceState(null, '', '/store')
  const router = createBrowserRouter(routes)
  render(
    <QueryClientProvider client={createQueryClient({ retryDelay: 0 })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const cardLink = async () => (await screen.findByRole('heading', { name: card.name })).closest('a')!

describe('opening a product from a picture of it', () => {
  it('moves the clicked card’s cover into the product page, which skips its own entrance', async () => {
    browser({ reducedMotion: false })
    storeApi()
    const router = openStore()

    fireEvent.click(await cardLink())

    // The router changes address first and starts the transition just after, as the new page is drawn.
    await waitFor(() => expect(startViewTransition).toHaveBeenCalledTimes(1))
    expect(router.state.location.pathname).toBe(`/product/${card.slug}`)
    // Exactly one picture carried the name when the old page was pictured: the clicked card's cover.
    expect(namedAtStart).toEqual([expect.stringContaining('aspect-[3/4]')])
    expect(router.state.location.state).toEqual({ morph: true })

    const cover = await screen.findByRole('img', { name: `Cover of ${showExample.response.data.game.title}` })
    expect(cover.closest('[data-cover-target]')).toHaveStyle({ viewTransitionName: COVER_NAME })
    expect(cover.closest('article')).toHaveClass('spot-arrived')
  })

  it('opens the page plainly for a visitor who prefers reduced motion', async () => {
    browser({ reducedMotion: true })
    storeApi()
    const router = openStore()

    fireEvent.click(await cardLink())

    await waitFor(() => expect(router.state.location.pathname).toBe(`/product/${card.slug}`))
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(router.state.location.state).toBeNull()
    expect((await screen.findByRole('heading', { level: 1 })).closest('article')).not.toHaveClass('spot-arrived')
  })

  it('leaves a click that opens a new tab to the browser', async () => {
    browser({ reducedMotion: false })
    storeApi()
    const router = openStore()
    const link = await cardLink()

    // fireEvent returns false when something called preventDefault.
    const handled = !fireEvent.click(link, { ctrlKey: true })

    expect(handled).toBe(false)
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/store')
  })
})
