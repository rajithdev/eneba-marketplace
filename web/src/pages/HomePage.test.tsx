import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import homepageExample from '../contracts/homepage.json'
import type { HomepageBlock } from '../lib/homepage'
import { mockApi, renderAt } from '../test/render'

const blocks: HomepageBlock[] = homepageExample.response.data.blocks
const [hero, bestSellers, deals, featured] = blocks

/** The API answering with these blocks. Returns the list of requests made. */
function homepageApi(served: unknown[] = blocks, status = 200) {
  return mockApi((path) => (path === '/api/homepage' ? { status, body: { data: { blocks: served } } } : undefined))
}

const sectionTitles = () => screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)

describe('homepage', () => {
  it('asks the API once and draws the blocks it returns, in that order', async () => {
    const requested = homepageApi()
    renderAt('/')

    expect(await screen.findByRole('heading', { level: 2, name: bestSellers.title! })).toBeInTheDocument()
    expect(requested.filter((path) => path === '/api/homepage')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    // The hero's own headline, then each block's title.
    expect(sectionTitles()).toEqual([hero.data.banners![0].title, bestSellers.title, deals.title, featured.title])
  })

  it('follows the order the API gives, whatever it is', async () => {
    homepageApi([featured, deals, bestSellers, hero])
    renderAt('/')

    await screen.findByRole('heading', { level: 2, name: featured.title! })

    expect(sectionTitles()).toEqual([featured.title, deals.title, bestSellers.title, hero.data.banners![0].title])
  })

  it('takes titles and links from the API, not from its own code', async () => {
    homepageApi([{ ...bestSellers, title: 'What everyone is buying', link: { label: 'More like these', url: '/store?type=dlc' } }])
    renderAt('/')

    expect(await screen.findByRole('heading', { level: 2, name: 'What everyone is buying' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'More like these' })).toHaveAttribute('href', '/store?type=dlc')
    // Nothing of the usual page appears unless the API sends it.
    expect(screen.queryByText(bestSellers.title!)).not.toBeInTheDocument()
    expect(screen.queryByText(deals.title!)).not.toBeInTheDocument()
    expect(screen.queryByText(hero.data.banners![0].title)).not.toBeInTheDocument()
  })

  it('shows the first banner large and the others as tiles, each linking where the API says', async () => {
    homepageApi()
    renderAt('/')
    const [main, ...others] = hero.data.banners!

    const highlights = within(await screen.findByRole('region', { name: 'Highlights' }))
    expect(highlights.getByRole('heading', { level: 2, name: main.title })).toBeInTheDocument()
    expect(highlights.getByText(main.subtitle!)).toBeInTheDocument()
    expect(highlights.getByRole('link', { name: main.cta_label! })).toHaveAttribute('href', main.link_url)

    for (const banner of others) {
      expect(highlights.getByRole('link', { name: new RegExp(banner.title) })).toHaveAttribute('href', banner.link_url)
      expect(highlights.getByText(banner.subtitle!)).toBeInTheDocument()
    }
  })

  it('lists best sellers as a ranked chart with the prices the API gave', async () => {
    homepageApi()
    renderAt('/')

    const chart = within(await screen.findByRole('region', { name: bestSellers.title! }))
    const rows = chart.getAllByRole('listitem')
    const products = bestSellers.data.products!

    expect(rows).toHaveLength(products.length)
    products.forEach((product, index) => {
      const row = within(rows[index])
      expect(row.getByRole('heading', { level: 3, name: product.name })).toBeInTheDocument()
      expect(row.getByRole('link')).toHaveAttribute('href', `/product/${product.slug}`)
      expect(row.getByText(`Number ${index + 1}:`)).toBeInTheDocument()
      expect(rows[index]).toHaveTextContent(`€${(product.price!.amount_cents / 100).toFixed(2)}`)
    })
    expect(chart.getByRole('link', { name: bestSellers.link!.label })).toHaveAttribute('href', bestSellers.link!.url)
  })

  it('shows each deal under its discount', async () => {
    homepageApi()
    renderAt('/')

    const band = within(await screen.findByRole('region', { name: deals.title! }))
    const cards = band.getAllByRole('listitem')

    deals.data.products!.forEach((product, index) => {
      expect(cards[index]).toHaveTextContent(`Save −${product.price!.discount_percent}%`)
      expect(within(cards[index]).getByRole('link', { name: new RegExp(product.name.slice(0, 12)) })).toHaveAttribute('href', `/product/${product.slug}`)
    })
  })

  it('shows the first featured product large and the rest as cards', async () => {
    homepageApi()
    renderAt('/')
    const [spotlight, ...rest] = featured.data.products!

    const picks = within(await screen.findByRole('region', { name: featured.title! }))
    expect(picks.getByRole('heading', { level: 3, name: spotlight.name })).toBeInTheDocument()
    expect(picks.getByText(new RegExp(`${spotlight.offers_count} offers? to compare`))).toBeInTheDocument()
    expect(picks.getAllByRole('listitem')).toHaveLength(rest.length)
    for (const product of rest) {
      expect(picks.getByRole('heading', { level: 3, name: product.name })).toBeInTheDocument()
    }
  })

  it('skips a block type it does not know and still draws the rest', async () => {
    homepageApi([{ id: 99, type: 'countdown_timer', title: 'Ends soon', link: null, data: { ends_at: '2030-01-01' } }, deals])
    renderAt('/')

    expect(await screen.findByRole('heading', { level: 2, name: deals.title! })).toBeInTheDocument()
    expect(screen.queryByText('Ends soon')).not.toBeInTheDocument()
  })

  it('draws a block whose content is thinner than usual without breaking', async () => {
    const oneBanner = { ...hero, data: { banners: [{ ...hero.data.banners![0], subtitle: null, image_url: null, cta_label: null }] } }
    const onePick = { ...featured, data: { products: [featured.data.products![0]] } }
    homepageApi([oneBanner, onePick])
    renderAt('/')

    const main = hero.data.banners![0]
    expect(await screen.findByRole('heading', { level: 2, name: main.title })).toBeInTheDocument()
    // With no button text of its own, the banner's title is the link.
    expect(screen.getByRole('link', { name: main.title })).toHaveAttribute('href', main.link_url)
    expect(screen.getByRole('heading', { level: 3, name: onePick.data.products[0].name })).toBeInTheDocument()
  })

  it('shows a plain introduction when the API returns no blocks', async () => {
    homepageApi([])
    renderAt('/')

    expect(await screen.findByRole('heading', { level: 1, name: 'Game keys, gift cards and subscriptions' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Browse the store' })).toHaveAttribute('href', '/store')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says so when the homepage cannot be loaded, still leads to the store, and can try again', async () => {
    let healthy = false
    mockApi((path) => (path === '/api/homepage' ? (healthy ? { body: homepageExample.response } : { status: 502, body: { message: 'Bad gateway' } }) : undefined))
    renderAt('/')

    expect(await screen.findByRole('alert')).toHaveTextContent('The homepage could not be loaded')
    expect(screen.getByRole('link', { name: 'Browse the store' })).toHaveAttribute('href', '/store')

    healthy = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 2, name: deals.title! })).toBeInTheDocument()
  })

  it('shows a loading state inside the shared header and navigation', () => {
    homepageApi()
    renderAt('/')

    expect(screen.getByRole('status', { name: 'Loading the homepage' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav).toHaveTextContent('Cart')
    expect(nav).toHaveTextContent('Account')
    expect(within(screen.getByRole('navigation', { name: 'Categories' })).getByRole('link', { name: 'Store' })).toHaveAttribute('href', '/archive')
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
  })
})

it('shows a not-found page for an address that does not exist', () => {
  mockApi(() => undefined)
  renderAt('/no-such-page')

  expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
})
