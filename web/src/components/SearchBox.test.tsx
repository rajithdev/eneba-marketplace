import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import filtersExample from '../contracts/filters.json'
import listExample from '../contracts/products.list.json'
import showExample from '../contracts/products.show.json'
import suggestionsExample from '../contracts/search.suggestions.json'
import { renderAt } from '../test/render'

const suggested = suggestionsExample.response.data

/**
 * The backend. `suggest` answers the suggestions endpoint for a term (it may
 * return a promise to keep a request waiting). Every suggestion request is
 * recorded with its abort signal.
 */
function searchApi(suggest: (term: string) => unknown = () => suggestionsExample.response) {
  const requests: { term: string; signal: AbortSignal | null | undefined }[] = []

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

    if (url.pathname === '/api/search/suggestions') {
      requests.push({ term: url.searchParams.get('q') ?? '', signal: init?.signal })
      const body = await suggest(url.searchParams.get('q') ?? '')
      if (init?.signal?.aborted) throw new DOMException('The request was abandoned.', 'AbortError')

      return body instanceof Response ? body : json(body)
    }
    if (url.pathname === '/api/filters') return json(filtersExample.response)
    if (url.pathname === '/api/products') return json(listExample.response)
    if (url.pathname.startsWith('/api/products/')) return json(showExample.response)

    return json({ message: 'Not found.' }, 404)
  })

  return requests
}

const box = () => screen.getByRole('combobox', { name: 'Search products' })
const type = (text: string) => fireEvent.change(box(), { target: { value: text } })
const press = (key: string) => fireEvent.keyDown(box(), { key })
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const options = () => screen.queryAllByRole('option')

describe('header search box', () => {
  it('does not ask the server for a single letter', async () => {
    const requests = searchApi()
    renderAt('/')

    type('e')
    await pause(400)

    expect(requests).toHaveLength(0)
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    expect(options()).toHaveLength(0)
  })

  it('waits for a pause in typing and then asks once, for the final text', async () => {
    const requests = searchApi()
    renderAt('/')

    for (const text of ['el', 'eld', 'elde', 'elden']) {
      type(text)
      await pause(40)
    }

    await screen.findByRole('option', { name: new RegExp(suggested[0].name) })
    expect(requests.map((request) => request.term)).toEqual(['elden'])
  })

  it('lists the suggestions with their price, then a way to see every result', async () => {
    searchApi()
    renderAt('/')

    type('eldn ring')

    const list = await screen.findByRole('listbox', { name: 'Suggestions' })
    await within(list).findByRole('option', { name: new RegExp(suggested[0].name) })

    expect(box()).toHaveAttribute('aria-expanded', 'true')
    expect(box()).toHaveAttribute('aria-controls', list.id)
    expect(options().map((option) => option.textContent)).toEqual([
      ...suggested.map((product) => expect.stringContaining(product.name)),
      'See all results for “eldn ring”',
    ])
    expect(options()[0]).toHaveTextContent('€36.49')
    // Announced to screen readers.
    expect(within(screen.getByRole('search')).getByRole('status')).toHaveTextContent(`${suggested.length} suggestions.`)
  })

  it('moves through the suggestions with the arrow keys and opens the highlighted one with Enter', async () => {
    searchApi()
    const router = renderAt('/')

    type('eldn ring')
    await screen.findByRole('option', { name: new RegExp(suggested[0].name) })
    expect(box()).not.toHaveAttribute('aria-activedescendant')

    press('ArrowDown')
    expect(box()).toHaveAttribute('aria-activedescendant', options()[0].id)
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')

    press('ArrowDown')
    expect(box()).toHaveAttribute('aria-activedescendant', options()[1].id)
    expect(options()[0]).toHaveAttribute('aria-selected', 'false')

    press('ArrowUp')
    expect(box()).toHaveAttribute('aria-activedescendant', options()[0].id)

    fireEvent.submit(box().closest('form')!)

    await waitFor(() => expect(router.state.location.pathname).toBe(`/product/${suggested[0].slug}`))
    expect(box()).toHaveValue('')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
  })

  it('wraps around at both ends of the list', async () => {
    searchApi()
    renderAt('/')

    type('eldn ring')
    await screen.findByRole('option', { name: new RegExp(suggested[0].name) })
    const last = options().length - 1

    press('ArrowUp')
    expect(box()).toHaveAttribute('aria-activedescendant', options()[last].id)
    expect(options()[last]).toHaveTextContent('See all results')

    press('ArrowDown')
    expect(box()).toHaveAttribute('aria-activedescendant', options()[0].id)
  })

  it('opens the store with the search in the address when Enter is pressed without choosing', async () => {
    searchApi()
    const router = renderAt('/')

    type('  elden   ring ')
    fireEvent.submit(box().closest('form')!)

    await waitFor(() => expect(router.state.location.pathname).toBe('/store'))
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('elden ring')
    expect(await screen.findByRole('heading', { level: 1, name: 'Results for “elden ring”' })).toBeInTheDocument()
    // The box now shows what the address says.
    expect(box()).toHaveValue('elden ring')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
  })

  it('carries special characters into the address intact', async () => {
    searchApi()
    const router = renderAt('/')

    type('100% & more? #1')
    fireEvent.submit(box().closest('form')!)

    await waitFor(() => expect(router.state.location.pathname).toBe('/store'))
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('100% & more? #1')
  })

  it('opens the whole store for an empty search', async () => {
    searchApi()
    const router = renderAt('/account')

    fireEvent.submit(box().closest('form')!)

    await waitFor(() => expect(router.state.location.pathname).toBe('/store'))
    expect(router.state.location.search).toBe('')
  })

  it('opens the store from the "see all results" option', async () => {
    searchApi()
    const router = renderAt('/')

    type('eldn ring')
    fireEvent.click(await screen.findByRole('option', { name: 'See all results for “eldn ring”' }))

    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('q')).toBe('eldn ring'))
  })

  it('opens a product when its suggestion is clicked', async () => {
    searchApi()
    const router = renderAt('/')

    type('eldn ring')
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(suggested[2].name) }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/product/${suggested[2].slug}`))
  })

  it('closes on Escape, keeping the text and the focus in the box', async () => {
    searchApi()
    renderAt('/')

    box().focus()
    type('eldn ring')
    await screen.findByRole('option', { name: new RegExp(suggested[0].name) })
    press('ArrowDown')

    press('Escape')

    expect(box()).toHaveAttribute('aria-expanded', 'false')
    expect(options()).toHaveLength(0)
    expect(box()).toHaveValue('eldn ring')
    expect(box()).toHaveFocus()
    expect(box()).not.toHaveAttribute('aria-activedescendant')

    // The arrow key brings the list back.
    press('ArrowDown')
    expect(box()).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes when focus leaves the search', async () => {
    searchApi()
    renderAt('/')

    type('eldn ring')
    await screen.findByRole('option', { name: new RegExp(suggested[0].name) })

    fireEvent.blur(box(), { relatedTarget: screen.getByRole('link', { name: 'Account' }) })

    expect(box()).toHaveAttribute('aria-expanded', 'false')
  })

  it('abandons the request for text that is no longer in the box', async () => {
    let release: (value: unknown) => void = () => {}
    const requests = searchApi((term) =>
      term === 'eld' ? new Promise((resolve) => (release = resolve)) : suggestionsExample.response,
    )
    renderAt('/')

    type('eld')
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].signal?.aborted).toBe(false)

    type('elden')
    await screen.findByRole('option', { name: new RegExp(suggested[0].name) })

    expect(requests.map((request) => request.term)).toEqual(['eld', 'elden'])
    expect(requests[0].signal?.aborted).toBe(true)

    // Even if the old answer arrives late, it is not shown.
    release({ data: [{ ...suggested[0], name: 'Stale answer' }] })
    await pause(50)
    expect(screen.queryByText('Stale answer')).not.toBeInTheDocument()
  })

  it('says it is searching while it waits, and says so when nothing was found', async () => {
    let release: (value: unknown) => void = () => {}
    const requests = searchApi(() => new Promise((resolve) => (release = resolve)))
    renderAt('/')

    type('zzz')

    // Shown straight away, while the box is still waiting for a pause in typing...
    expect(await screen.findByText('Searching…', { selector: 'li' })).toBeInTheDocument()
    expect(within(screen.getByRole('search')).getByRole('status')).toHaveTextContent('Searching…')
    // Searching the store is possible without waiting for suggestions.
    expect(screen.getByRole('option', { name: 'See all results for “zzz”' })).toBeInTheDocument()

    // ...and still shown once the request is on its way.
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(screen.getByText('Searching…', { selector: 'li' })).toBeInTheDocument()

    release({ data: [] })

    expect(await screen.findByText('No suggestions for “zzz”.')).toBeInTheDocument()
    expect(within(screen.getByRole('search')).getByRole('status')).toHaveTextContent('No suggestions.')
    expect(options()).toHaveLength(1)
  })

  it('still lets the visitor search the store when suggestions fail', async () => {
    searchApi(() => new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 }))
    const router = renderAt('/')

    type('elden')

    expect(await screen.findByText('Suggestions are unavailable right now.', {}, { timeout: 3000 })).toBeInTheDocument()

    fireEvent.submit(box().closest('form')!)
    await waitFor(() => expect(router.state.location.pathname).toBe('/store'))
  })

  it('shows the search from the address and follows it when the address changes', async () => {
    searchApi()
    const router = renderAt('/store?q=witcher&platform=steam')

    expect(box()).toHaveValue('witcher')

    await router.navigate('/store?platform=steam')
    await waitFor(() => expect(box()).toHaveValue(''))

    await router.navigate(-1)
    await waitFor(() => expect(box()).toHaveValue('witcher'))
  })
})
