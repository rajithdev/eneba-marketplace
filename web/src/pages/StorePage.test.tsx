import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import filtersExample from '../contracts/filters.json'
import listExample from '../contracts/products.list.json'
import { mockApi, renderAt } from '../test/render'

/** The backend, answering with the recorded example responses. */
function storeApi(products: unknown = listExample.response) {
  return mockApi((path) => {
    if (path === '/api/filters') return { body: filtersExample.response }
    if (path === '/api/products') return { body: products }
  })
}

const [discounted, fullPrice, soldOut] = listExample.response.data
const productRequests = (requested: string[]) => requested.filter((url) => url.startsWith('/api/products'))

describe('store page', () => {
  it('shows the products the API returned, with prices, discounts and availability', async () => {
    storeApi()
    renderAt('/store')

    const card = (await screen.findByRole('heading', { name: discounted.name })).closest('a')!
    expect(card).toHaveAttribute('href', `/product/${discounted.slug}`)
    expect(within(card).getByText('€13.29')).toBeInTheDocument()
    expect(within(card).getByText('€17.49')).toBeInTheDocument()
    expect(within(card).getByText('-24%')).toBeInTheDocument()
    expect(within(card).getByText('5 offers')).toBeInTheDocument()

    const plain = screen.getByRole('heading', { name: fullPrice.name }).closest('a')!
    expect(within(plain).getByText('€34.29')).toBeInTheDocument()
    expect(within(plain).queryByText(/%/)).not.toBeInTheDocument()

    const unavailable = screen.getByRole('heading', { name: soldOut.name }).closest('a')!
    expect(within(unavailable).getAllByText('Sold out').length).toBeGreaterThan(0)
    expect(within(unavailable).queryByText(/€/)).not.toBeInTheDocument()

    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('3 products')
  })

  it('builds the filter panel and sort menu from what the API offers', async () => {
    storeApi()
    renderAt('/store')

    for (const platform of filtersExample.response.data.platforms) {
      expect(await screen.findByRole('checkbox', { name: new RegExp(platform.name) })).toBeInTheDocument()
    }
    const sort = screen.getByRole('combobox', { name: 'Sort by' })
    expect(within(sort).getAllByRole('option').map((option) => option.textContent)).toEqual(
      filtersExample.response.data.sorts.map((option) => option.label),
    )
  })

  it('restores filters, sort and page from the address (refresh or shared link)', async () => {
    const requested = storeApi()
    renderAt('/store?platform=ea-app,steam&region=global&min_price=1000&max_price=4000&sort=price_asc&page=2')

    expect(await screen.findByRole('checkbox', { name: /EA App/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Steam/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Global/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Xbox Live/ })).not.toBeChecked()
    expect(screen.getByLabelText('Minimum price')).toHaveValue('10.00')
    expect(screen.getByLabelText('Maximum price')).toHaveValue('40.00')
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('price_asc')

    expect(decodeURIComponent(productRequests(requested)[0])).toBe(
      '/api/products?platform=ea-app,steam&region=global&min_price=1000&max_price=4000&sort=price_asc&page=2',
    )
  })

  it('puts a ticked filter in the address, asks the API again, and returns to page 1', async () => {
    const requested = storeApi()
    const router = renderAt('/store?page=2')

    fireEvent.click(await screen.findByRole('checkbox', { name: /Steam/ }))

    await waitFor(() => expect(router.state.location.search).toBe('?platform=steam'))
    await waitFor(() => expect(productRequests(requested).at(-1)).toBe('/api/products?platform=steam'))

    // Unticking takes it out again.
    fireEvent.click(screen.getByRole('checkbox', { name: /Steam/ }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('puts the chosen sort order in the address, and leaves the default one out', async () => {
    storeApi()
    const router = renderAt('/store?platform=steam&page=3')
    const sort = await screen.findByRole('combobox', { name: 'Sort by' })

    fireEvent.change(sort, { target: { value: 'price_desc' } })
    await waitFor(() => expect(router.state.location.search).toBe('?platform=steam&sort=price_desc'))

    fireEvent.change(sort, { target: { value: filtersExample.response.data.default_sort } })
    await waitFor(() => expect(router.state.location.search).toBe('?platform=steam'))
  })

  it('turns a price typed in euros into cents in the address', async () => {
    storeApi()
    const router = renderAt('/store')

    fireEvent.change(await screen.findByLabelText('Minimum price'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Maximum price'), { target: { value: '25,50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply price' }))

    await waitFor(() => expect(router.state.location.search).toBe('?min_price=1000&max_price=2550'))
  })

  it('links each page to its own address, keeping the filters', async () => {
    storeApi({ ...listExample.response, meta: { current_page: 2, per_page: 24, total: 60, last_page: 3 } })
    renderAt('/store?platform=steam&page=2')

    const pagination = await screen.findByRole('navigation', { name: 'Pagination' })
    expect(within(pagination).getByText('2').closest('[aria-current="page"]')).not.toBeNull()
    expect(within(pagination).getByRole('link', { name: 'Page 3' })).toHaveAttribute('href', '/store?platform=steam&page=3')
    expect(within(pagination).getByRole('link', { name: 'Page 1' })).toHaveAttribute('href', '/store?platform=steam')
    expect(within(pagination).getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/store?platform=steam&page=3')
    expect(within(pagination).getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/store?platform=steam')
  })

  it('offers to clear the filters when nothing matches', async () => {
    storeApi({ data: [], meta: { current_page: 1, per_page: 24, total: 0, last_page: 1 } })
    const router = renderAt('/store?platform=steam&sort=newest')

    expect(await screen.findByRole('heading', { name: 'No products match these filters' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('link', { name: 'Clear filters' })[0])

    await waitFor(() => expect(router.state.location.search).toBe('?sort=newest'))
  })

  it('explains an address the API rejects, without retrying it', async () => {
    const requested = mockApi((path) => {
      if (path === '/api/filters') return { body: filtersExample.response }
      if (path === '/api/products') return { status: 422, body: { message: 'Unknown platform.', errors: { 'platform.0': ['Unknown platform "x".'] } } }
    })
    renderAt('/store?platform=x')

    expect(await screen.findByRole('heading', { name: 'These filters are not valid' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Show all products' })).toHaveAttribute('href', '/store')
    expect(productRequests(requested)).toHaveLength(1)
  })

  it('says a refused search cannot be retried and offers the whole store instead', async () => {
    const requested = mockApi((path) => {
      if (path === '/api/filters') return { body: filtersExample.response }
      // What the API host's firewall answers for text that looks like an attack.
      if (path === '/api/products') return { status: 403, body: 'Blocked' }
    })
    renderAt('/store?q=1+OR+1%3D1')

    expect(await screen.findByRole('heading', { name: 'This search could not be run' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Show all products' })).toHaveAttribute('href', '/store')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(productRequests(requested)).toHaveLength(1)
  })

  it('shows a real failure as a failure and lets the visitor try again', async () => {
    let healthy = false
    mockApi((path) => {
      if (path === '/api/filters') return { body: filtersExample.response }
      if (path === '/api/products') return healthy ? { body: listExample.response } : { status: 502, body: { message: 'Bad gateway' } }
    })
    renderAt('/store')

    expect(await screen.findByRole('heading', { name: 'The products could not be loaded' })).toBeInTheDocument()
    expect(screen.queryByText('No products match these filters')).not.toBeInTheDocument()

    healthy = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: discounted.name })).toBeInTheDocument()
  })

  it('opens and closes the filters on small screens, saying how many are active', async () => {
    storeApi()
    renderAt('/store?platform=steam&region=europe')

    const toggle = await screen.findByRole('button', { name: 'Filters (2)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide filters (2)' })).toHaveAttribute('aria-expanded', 'true')
  })

  describe('searching', () => {
    it('sends the search in the address to the API along with the filters', async () => {
      const requested = storeApi()
      renderAt('/store?q=witcher&platform=steam&page=2')

      expect(await screen.findByRole('heading', { level: 1, name: 'Results for “witcher”' })).toBeInTheDocument()
      expect(productRequests(requested)[0]).toBe('/api/products?q=witcher&platform=steam&page=2')
      expect(document.title).toBe('Search: witcher | keymarket')
      await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('3 products found'))
    })

    it('offers "best match" as the order, and it is the default while searching', async () => {
      storeApi()
      const router = renderAt('/store?q=witcher')
      const sort = await screen.findByRole('combobox', { name: 'Sort by' })

      expect(within(sort).getAllByRole('option').map((option) => option.textContent)).toEqual([
        filtersExample.response.data.search.sort.label,
        ...filtersExample.response.data.sorts.map((option) => option.label),
      ])
      expect(sort).toHaveValue('relevance')

      fireEvent.change(sort, { target: { value: 'price_asc' } })
      await waitFor(() => expect(router.state.location.search).toBe('?q=witcher&sort=price_asc'))

      // Back to the default: no parameter needed.
      fireEvent.change(sort, { target: { value: 'relevance' } })
      await waitFor(() => expect(router.state.location.search).toBe('?q=witcher'))
    })

    it('does not offer "best match" when there is nothing to match', async () => {
      storeApi()
      renderAt('/store')
      const sort = await screen.findByRole('combobox', { name: 'Sort by' })

      expect(within(sort).queryByRole('option', { name: 'Best match' })).not.toBeInTheDocument()
      expect(sort).toHaveValue(filtersExample.response.data.default_sort)
    })

    it('keeps the search when a filter changes, and returns to page 1', async () => {
      const requested = storeApi()
      const router = renderAt('/store?q=witcher&page=3')

      fireEvent.click(await screen.findByRole('checkbox', { name: /Steam/ }))

      await waitFor(() => expect(router.state.location.search).toBe('?q=witcher&platform=steam'))
      await waitFor(() => expect(productRequests(requested).at(-1)).toBe('/api/products?q=witcher&platform=steam'))
    })

    it('keeps the search in every page link', async () => {
      storeApi({ ...listExample.response, meta: { current_page: 1, per_page: 24, total: 60, last_page: 3 } })
      renderAt('/store?q=witcher&platform=steam')

      const pagination = await screen.findByRole('navigation', { name: 'Pagination' })
      expect(within(pagination).getByRole('link', { name: 'Page 2' })).toHaveAttribute('href', '/store?q=witcher&platform=steam&page=2')
    })

    it('clears the search but keeps the filters', async () => {
      storeApi()
      const router = renderAt('/store?q=witcher&platform=steam&sort=price_asc&page=2')

      fireEvent.click(await screen.findByRole('link', { name: 'Clear search' }))

      await waitFor(() => expect(router.state.location.search).toBe('?platform=steam&sort=price_asc'))
      expect(await screen.findByRole('heading', { level: 1, name: 'Store' })).toBeInTheDocument()
    })

    it('clears the filters but keeps the search', async () => {
      storeApi()
      const router = renderAt('/store?q=witcher&platform=steam&min_price=100')

      fireEvent.click(await screen.findByRole('link', { name: 'Clear filters' }))

      await waitFor(() => expect(router.state.location.search).toBe('?q=witcher'))
    })

    it('names the search when nothing matches it', async () => {
      storeApi({ data: [], meta: { current_page: 1, per_page: 24, total: 0, last_page: 1 } })
      renderAt('/store?q=zzzz')

      expect(await screen.findByRole('heading', { name: 'No products match “zzzz”' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Show all products' })).toHaveAttribute('href', '/store')
    })
  })
})
