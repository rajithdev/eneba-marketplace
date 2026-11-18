import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import filtersExample from '../contracts/filters.json'
import listExample from '../contracts/products.list.json'
import { mockApi, renderAt } from '../test/render'
import { REACH } from './shelf'

const [discounted, fullPrice, soldOut] = listExample.response.data

/** The backend, answering with the recorded example responses. `products` may answer differently for each page asked for. */
function archiveApi(products: (page: number) => unknown = () => listExample.response) {
  return mockApi((path, query) => {
    if (path === '/api/filters') return { body: filtersExample.response }
    if (path === '/api/products') return { body: products(Number(query.get('page') ?? 1)) }
  })
}

const productRequests = (requested: string[]) => requested.filter((url) => url.startsWith('/api/products'))
const shelf = () => screen.findByRole('listbox', { name: 'Games in the archive' })
const chosen = () => screen.getByRole('region', { name: 'Chosen game' })
/** Queries inside the shelf: the page has other lists of options (the order menu, the search box). */
const inShelf = () => within(screen.getByRole('listbox', { name: 'Games in the archive' }))
const cases = () => inShelf().getAllByRole('option').map((option) => option.getAttribute('aria-label'))
const chosenCase = () => inShelf().getByRole('option', { selected: true })

/** A browser whose window is wide and tall enough for the stage, and whose visitor has not asked for reduced motion. */
function wideWindow() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: !query.includes('reduce') || query.includes('no-preference'), addEventListener: () => {}, removeEventListener: () => {} }))
}

afterEach(() => vi.unstubAllGlobals())

describe.each([
  ['on the rail (a phone, or reduced motion)', () => {}],
  ['on the stage (a wide window)', wideWindow],
])('game archive %s', (_where, setUp) => {
  it('shows the products the API returned as cases, and the first as the chosen one', async () => {
    setUp()
    archiveApi()
    renderAt('/archive')

    await shelf()
    expect(cases()).toEqual([`${discounted.name}, from €13.29`, `${fullPrice.name}, from €34.29`, `${soldOut.name}, sold out`])
    expect(chosenCase()).toHaveAccessibleName(`${discounted.name}, from €13.29`)

    // Under the shelf: its name, platform, region, lowest price with the discount, and the way to its offers.
    const details = chosen()
    expect(within(details).getByRole('heading', { name: discounted.name })).toBeInTheDocument()
    expect(details).toHaveTextContent(`Platform${discounted.platform.name}`)
    expect(details).toHaveTextContent(`Region${discounted.region.name}`)
    expect(within(details).getByText('€13.29')).toBeInTheDocument()
    expect(within(details).getByText('€17.49')).toBeInTheDocument()
    expect(within(details).getByText('-24%')).toBeInTheDocument()
    expect(within(details).getByRole('link', { name: 'View offers' })).toHaveAttribute('href', `/product/${discounted.slug}`)
    expect(details).toHaveTextContent('Game 001/ of 003')
  })

  it('moves along the shelf with the arrow keys and the arrow buttons', async () => {
    setUp()
    archiveApi()
    renderAt('/archive')
    const list = await shelf()

    expect(screen.getByRole('button', { name: 'Previous game' })).toBeDisabled()
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(within(chosen()).getByRole('heading', { name: fullPrice.name })).toBeInTheDocument()
    expect(within(chosen()).getByRole('link', { name: 'View offers' })).toHaveAttribute('href', `/product/${fullPrice.slug}`)
    expect(list).toHaveAttribute('aria-activedescendant', chosenCase().id)

    fireEvent.click(screen.getByRole('button', { name: 'Next game' }))
    expect(within(chosen()).getByRole('heading', { name: soldOut.name })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next game' })).toBeDisabled()

    fireEvent.keyDown(list, { key: 'Home' })
    expect(within(chosen()).getByRole('heading', { name: discounted.name })).toBeInTheDocument()
    fireEvent.keyDown(list, { key: 'End' })
    expect(within(chosen()).getByRole('heading', { name: soldOut.name })).toBeInTheDocument()
  })

  it('says a sold-out product is sold out, with no price', async () => {
    setUp()
    archiveApi()
    renderAt('/archive')

    fireEvent.keyDown(await shelf(), { key: 'End' })
    expect(within(chosen()).getByText('Sold out')).toBeInTheDocument()
    expect(within(chosen()).queryByText(/€/)).not.toBeInTheDocument()
    expect(within(chosen()).getByRole('link', { name: 'View offers' })).toHaveAttribute('href', `/product/${soldOut.slug}`)
  })

  it('chooses a case that is clicked, and opens the chosen one when it is clicked again or Enter is pressed', async () => {
    setUp()
    archiveApi()
    const router = renderAt('/archive')
    await shelf()

    fireEvent.click(inShelf().getByRole('option', { name: `${fullPrice.name}, from €34.29` }))
    expect(within(chosen()).getByRole('heading', { name: fullPrice.name })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/archive')

    fireEvent.click(chosenCase())
    await waitFor(() => expect(router.state.location.pathname).toBe(`/product/${fullPrice.slug}`))
  })

  it('opens the chosen product with Enter', async () => {
    setUp()
    archiveApi()
    const router = renderAt('/archive')

    fireEvent.keyDown(await shelf(), { key: 'Enter' })
    await waitFor(() => expect(router.state.location.pathname).toBe(`/product/${discounted.slug}`))
  })

  it('fetches the catalog a page at a time, the next one as the end of what it has comes near', async () => {
    setUp()
    const second = { ...fullPrice, slug: 'on-the-second-page', name: 'On The Second Page EA App Key GLOBAL' }
    const requested = archiveApi((page) =>
      page === 1
        ? { data: [discounted, fullPrice], meta: { current_page: 1, per_page: 2, total: 3, last_page: 2 } }
        : { data: [second], meta: { current_page: 2, per_page: 2, total: 3, last_page: 2 } },
    )
    renderAt('/archive?type=game')

    await shelf()
    expect(await inShelf().findByRole('option', { name: /On The Second Page/ })).toBeInTheDocument()
    expect(productRequests(requested)).toEqual(['/api/products?type=game', '/api/products?type=game&page=2'])
    expect(cases()).toHaveLength(3)
    // Three in all, and no fourth request once the last page is in.
    fireEvent.keyDown(await shelf(), { key: 'End' })
    expect(chosen()).toHaveTextContent('Game 003/ of 003')
    expect(productRequests(requested)).toHaveLength(2)
  })
})

describe('game archive', () => {
  it('asks the API for what the address says, as the store does, but never for a page', async () => {
    const requested = archiveApi()
    renderAt('/archive?platform=ea-app&type=game&sort=price_asc&page=3')

    await shelf()
    expect(productRequests(requested)).toEqual(['/api/products?platform=ea-app&type=game&sort=price_asc'])
    expect(screen.getByRole('combobox', { name: 'Shelved by' })).toHaveValue('price_asc')
  })

  it('offers the shelves and orders the API reports, as links in the address', async () => {
    archiveApi()
    const router = renderAt('/archive?sort=newest')
    await shelf()
    const shelves = within(screen.getByRole('navigation', { name: 'Shelves' }))

    for (const type of filtersExample.response.data.types) {
      expect(await shelves.findByRole('link', { name: type.label })).toHaveAttribute('href', `/archive?sort=newest&type=${type.value}`)
    }
    expect(shelves.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'true')

    const order = screen.getByRole('combobox', { name: 'Shelved by' })
    expect(within(order).getAllByRole('option').map((option) => option.textContent)).toEqual(filtersExample.response.data.sorts.map((option) => option.label))
    fireEvent.change(order, { target: { value: 'price_desc' } })
    expect(router.state.location.search).toBe('?sort=price_desc')
  })

  it('starts a new shelf at its first case when another one is chosen', async () => {
    const requested = archiveApi()
    renderAt('/archive')

    fireEvent.keyDown(await shelf(), { key: 'End' })
    expect(chosen()).toHaveTextContent('Game 003/ of 003')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Shelves' })).getByRole('link', { name: 'Games' }))

    await waitFor(() => expect(productRequests(requested)).toContain('/api/products?type=game'))
    await waitFor(() => expect(chosen()).toHaveTextContent('Game 001/ of 003'))
    expect(within(screen.getByRole('navigation', { name: 'Shelves' })).getByRole('link', { name: 'Games' })).toHaveAttribute('aria-current', 'true')
  })

  it('says so when nothing matches', async () => {
    archiveApi(() => ({ data: [], meta: { current_page: 1, per_page: 24, total: 0, last_page: 1 } }))
    renderAt('/archive?type=dlc')
    expect(await screen.findByRole('heading', { name: 'Nothing in the archive matches' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Show the whole archive' })).toHaveAttribute('href', '/archive')
  })

  it('reports an address the API rejects as not valid', async () => {
    mockApi((path) => {
      if (path === '/api/filters') return { body: filtersExample.response }
      if (path === '/api/products') return { status: 422, body: { message: 'The selected type is invalid.' } }
    })
    renderAt('/archive?type=nonsense')

    expect(await screen.findByRole('heading', { name: 'These filters are not valid' })).toBeInTheDocument()
  })

  it('keeps the ordinary catalog one click away, with the filters, order and search kept both ways', async () => {
    archiveApi()
    const router = renderAt('/archive?type=game&sort=price_asc&q=fc')
    await shelf()

    const toList = within(screen.getByRole('navigation', { name: 'Catalog view' })).getByRole('link', { name: 'Browse all' })
    expect(toList).toHaveAttribute('href', '/archive/all?type=game&sort=price_asc&q=fc')
    fireEvent.click(toList)

    // The store page itself: its filters, its sort menu, its cards.
    expect(await screen.findByRole('checkbox', { name: /Games/ })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('price_asc')
    expect((await screen.findByRole('heading', { name: discounted.name })).closest('a')).toHaveAttribute('href', `/product/${discounted.slug}`)
    expect(router.state.location.pathname).toBe('/archive/all')

    const toShelf = within(screen.getByRole('navigation', { name: 'Catalog view' })).getByRole('link', { name: 'Archive' })
    expect(toShelf).toHaveAttribute('href', '/archive?type=game&sort=price_asc&q=fc')
    expect(within(screen.getByRole('navigation', { name: 'Catalog view' })).getByRole('link', { name: 'Browse all' })).toHaveAttribute('aria-current', 'page')
  })

  it('leaves the store page as it was', async () => {
    archiveApi()
    renderAt('/store')

    expect(await screen.findByRole('heading', { level: 1, name: 'Store' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Catalog view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: 'Games in the archive' })).not.toBeInTheDocument()
  })

  it('draws only the cases near the chosen one on the stage, however long the shelf', async () => {
    wideWindow()
    const many = Array.from({ length: 24 }, (_, index) => ({ ...fullPrice, slug: `game-${index}`, name: `Game ${index} EA App Key GLOBAL` }))
    archiveApi(() => ({ data: many, meta: { current_page: 1, per_page: 24, total: 24, last_page: 1 } }))
    renderAt('/archive')
    const list = await shelf()

    // The chosen case and the few after it that can be seen; each says where it is among all 24.
    expect(inShelf().getAllByRole('option')).toHaveLength(1 + REACH)
    expect(chosenCase()).toHaveAttribute('aria-posinset', '1')
    expect(chosenCase()).toHaveAttribute('aria-setsize', '24')

    // The far end is chosen at once, and is in the page for the keyboard, before the shelf has travelled there.
    fireEvent.keyDown(list, { key: 'End' })
    expect(chosenCase()).toHaveAccessibleName('Game 23 EA App Key GLOBAL, from €34.29')
    expect(chosen()).toHaveTextContent('Game 024/ of 024')
  })
})
