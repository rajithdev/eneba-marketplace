import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import homepageExample from '../contracts/homepage.json'
import productExample from '../contracts/products.show.json'
import { cart } from '../lib/cart'
import { coverGame } from '../lib/coverArt'
import type { HomepageBlock } from '../lib/homepage'
import { formatMoney } from '../lib/money'
import { createQueryClient } from '../lib/queryClient'
import { mockApi } from '../test/render'
import { Showroom } from './Showroom'
import type { Panel } from './stage'

const blocks: HomepageBlock[] = homepageExample.response.data.blocks
const deals = blocks.find((block) => block.type === 'deals')!
const products = deals.data.products!
const square: Panel['quad'] = [[0.1, 0.3], [0.2, 0.32], [0.2, 0.7], [0.1, 0.72]]
// A panel for every product in the block, in another order than the block's.
const panels: Panel[] = [...products].reverse().map((product) => ({ game: coverGame(product.cover_image_url)!, quad: square }))

function show(shown = panels) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <Showroom block={deals} panels={shown} /> },
      { path: '/cart', element: <p>the cart</p> },
      { path: '/product/:slug', element: <p>a product page</p> },
    ],
    { initialEntries: ['/'] },
  )
  render(
    <QueryClientProvider client={createQueryClient({ retryDelay: 0 })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return router
}

/** The API answering for one product with one offer that can be bought. */
const selling = (slug: string, offerId: number, cents: number) =>
  mockApi((path) =>
    path === `/api/products/${slug}`
      ? { body: { data: { ...productExample.response.data, slug, name: products.find((product) => product.slug === slug)!.name, offers: [{ id: offerId, in_stock: true, price: { amount_cents: cents, currency: 'EUR', original_amount_cents: null, discount_percent: null }, seller: { slug: 'arcade-harbor', name: 'Arcade Harbor', rating_percent: 99, sales_count: 10 } }] } } }
      : undefined,
  )

const item = (product: (typeof products)[number]) => within(screen.getByRole('button', { name: `${product.name}: price and buying` }).closest('li')!)

describe('the showroom', () => {
  it('gives every panel the block\'s product for its game, with what the API sent about it', () => {
    show()

    expect(screen.getByRole('heading', { level: 2, name: deals.title! })).toBeInTheDocument()
    for (const product of products) {
      const details = item(product)
      const price = product.price!

      expect(details.getByRole('link', { name: product.name })).toHaveAttribute('href', `/product/${product.slug}`)
      expect(details.getByText(formatMoney(price.amount_cents, price.currency))).toBeInTheDocument()
      expect(details.getByText(`−${price.discount_percent}%`, { exact: false })).toBeInTheDocument()
      expect(details.getByRole('button', { name: `Add ${product.name} to the cart` })).toBeEnabled()
      expect(details.getByRole('button', { name: `Buy ${product.name} now` })).toBeEnabled()
    }
  })

  it('leaves out a panel whose game is not in the block', () => {
    show([...panels, { game: 'a-game-not-on-sale', quad: square }])

    expect(screen.getAllByRole('listitem')).toHaveLength(products.length)
  })

  it('pins a panel\'s details open when it is pressed, one at a time, and Escape lets go', () => {
    show()
    const [first, second] = products.map((product) => screen.getByRole('button', { name: `${product.name}: price and buying` }))

    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(second)
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(second).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(second, { key: 'Escape' })
    expect(second).toHaveAttribute('aria-expanded', 'false')
  })

  it('Add to cart puts the best offer in the cart and stays in the showroom', async () => {
    const product = products[1]
    selling(product.slug, 301, 2579)
    const router = show()

    fireEvent.click(item(product).getByRole('button', { name: `Add ${product.name} to the cart` }))

    await waitFor(() => expect(cart.items()).toEqual([{ offerId: 301, quantity: 1, unitPriceCents: 2579, productName: product.name, sellerName: 'Arcade Harbor' }]))
    expect(await item(product).findByText('Added ✓')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('Buy Now puts the best offer in the cart and opens the cart', async () => {
    const product = products[2]
    selling(product.slug, 302, 3029)
    const router = show()

    fireEvent.click(item(product).getByRole('button', { name: `Buy ${product.name} now` }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/cart'))
    expect(cart.items().map((entry) => [entry.offerId, entry.quantity])).toEqual([[302, 1]])
  })
})
