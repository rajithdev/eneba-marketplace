import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import showExample from '../contracts/products.show.json'
import { mockApi, renderAt } from '../test/render'

const product = showExample.response.data

function productApi(body: unknown = showExample.response, status = 200) {
  return mockApi((path) => (path.startsWith('/api/products/') ? { status, body } : undefined))
}

describe('product page', () => {
  it('asks the API for the product in the address and shows what the game is', async () => {
    const requested = productApi()
    renderAt(`/product/${product.slug}`)

    expect(await screen.findByRole('heading', { level: 1, name: product.name })).toBeInTheDocument()
    expect(requested).toEqual([`/api/products/${product.slug}`])

    expect(screen.getByText(product.game.description)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: `Cover of ${product.game.title}` })).toHaveAttribute('src', product.cover_image_url)
    expect(screen.getByText('25 Feb 2022')).toBeInTheDocument()

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByRole('link', { name: 'Store' })).toHaveAttribute('href', '/store')
  })

  it('lists every seller offer in the order the API gave, marking the first as the best price', async () => {
    productApi()
    renderAt(`/product/${product.slug}`)

    const table = await screen.findByRole('table', { name: /Offers from sellers/ })
    const rows = within(table).getAllByRole('row').slice(1)

    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual(
      product.offers.map((offer) => expect.stringContaining(offer.seller.name)),
    )
    expect(within(rows[0]).getByText('Best price')).toBeInTheDocument()
    expect(within(table).getAllByText('Best price')).toHaveLength(1)
    expect(within(rows[0]).getByText('€31.49')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/97\.9% positive · 12,406 sales/)).toBeInTheDocument()
    expect(within(table).getAllByText('In stock')).toHaveLength(product.offers.length)
  })

  it('shows the best offer with the same price as the first row', async () => {
    productApi()
    renderAt(`/product/${product.slug}`)

    const best = await screen.findByRole('region', { name: 'Best offer' })
    expect(within(best).getByText('€31.49')).toBeInTheDocument()
    expect(within(best).getByText(product.offers[0].seller.name)).toBeInTheDocument()
    expect(within(best).getByRole('link', { name: `Compare ${product.offers.length} offers` })).toHaveAttribute('href', '#offers')
  })

  it('links to the same game on other platforms and regions, with each price', async () => {
    productApi()
    renderAt(`/product/${product.slug}`)

    const section = (await screen.findByRole('heading', { name: 'Other platforms and regions' })).closest('section')!
    const links = within(section).getAllByRole('link')

    expect(links.map((link) => link.getAttribute('href'))).toEqual(product.variants.map((variant) => `/product/${variant.slug}`))
    expect(links[0]).toHaveTextContent('Xbox Live')
    expect(links[0]).toHaveTextContent('Europe')
    expect(links[0]).toHaveTextContent('From €30.49')
  })

  it('shows a sold-out product as sold out, with no best price', async () => {
    productApi({
      data: {
        ...product,
        in_stock: false,
        price: null,
        offers_count: 0,
        offers: product.offers.map((offer) => ({ ...offer, in_stock: false })),
        variants: [{ ...product.variants[0], in_stock: false, price: null, offers_count: 0 }],
      },
    })
    renderAt(`/product/${product.slug}`)

    const box = await screen.findByRole('region', { name: 'Best offer' })
    expect(within(box).getByText('Sold out')).toBeInTheDocument()
    expect(within(box).queryByText(/€/)).not.toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).queryByText('Best price')).not.toBeInTheDocument()
    expect(within(table).queryByText('In stock')).not.toBeInTheDocument()
    expect(within(table).getAllByText('Sold out')).toHaveLength(product.offers.length)
    // Offers still show their price: the buyer can see what it costs when back.
    expect(within(table).getAllByText('€31.49').length).toBeGreaterThan(0)

    expect(screen.getAllByRole('link').some((link) => link.textContent?.includes('Sold out'))).toBe(true)
  })

  it('says so when the product does not exist, without retrying', async () => {
    const requested = productApi({ message: 'Product not found.' }, 404)
    renderAt('/product/no-such-product')

    expect(await screen.findByRole('heading', { name: 'Product not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the store' })).toHaveAttribute('href', '/store')
    expect(requested).toHaveLength(1)
  })

  it('shows a server failure as a failure, not as a missing product', async () => {
    productApi({ message: 'Server Error' }, 500)
    renderAt(`/product/${product.slug}`)

    expect(await screen.findByRole('heading', { name: 'The product could not be loaded' })).toBeInTheDocument()
    expect(screen.queryByText('Product not found')).not.toBeInTheDocument()
  })
})
