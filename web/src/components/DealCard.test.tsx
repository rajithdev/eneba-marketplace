import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import homepageExample from '../contracts/homepage.json'
import productExample from '../contracts/products.show.json'
import { cart } from '../lib/cart'
import { coverArt } from '../lib/coverArt'
import type { HomepageBlock } from '../lib/homepage'
import { formatMoney } from '../lib/money'
import { mockApi, renderAt } from '../test/render'

const blocks: HomepageBlock[] = homepageExample.response.data.blocks
const deals = blocks.find((block) => block.type === 'deals')!
const product = deals.data.products![0]

/** The product as its own page would get it, with these offers. */
const detail = (offers: { id: number; in_stock: boolean; cents: number; seller: string }[]) => ({
  data: {
    ...productExample.response.data,
    ...product,
    offers: offers.map((offer) => ({
      id: offer.id,
      in_stock: offer.in_stock,
      price: { amount_cents: offer.cents, currency: 'EUR', original_amount_cents: null, discount_percent: null },
      seller: { slug: offer.seller.toLowerCase(), name: offer.seller, rating_percent: 99, sales_count: 10 },
    })),
  },
})

/** The API answering with the homepage, and for the product whatever `productReply` gives. */
function api(productReply: { status?: number; body: unknown }) {
  return mockApi((path) => {
    if (path === '/api/homepage') return { body: { data: { blocks: [deals] } } }
    if (path === `/api/products/${product.slug}`) return productReply
    return undefined
  })
}

const firstCard = async () => within((await within(await screen.findByRole('region', { name: deals.title! })).findAllByRole('listitem'))[0])

beforeEach(() => cart.clear())

describe('a deals card', () => {
  it('shows what the API sent: the title, the discount, the price, what it was and how many offers', async () => {
    api({ body: detail([]) })
    renderAt('/')
    const card = await firstCard()
    const price = product.price!

    expect(card.getByRole('heading', { level: 3, name: product.name })).toBeInTheDocument()
    expect(card.getByText(`−${price.discount_percent}%`, { exact: false })).toBeInTheDocument()
    expect(card.getByText(formatMoney(price.amount_cents, price.currency))).toBeInTheDocument()
    expect(card.getByText(formatMoney(price.original_amount_cents!, price.currency))).toBeInTheDocument()
    expect(card.getByText(new RegExp(`${product.offers_count} offers?`))).toBeInTheDocument()
    expect(card.getByRole('link', { name: new RegExp(product.name) })).toHaveAttribute('href', `/product/${product.slug}`)
  })

  it('shows the painted cover of the game the API names, and leaves any other address alone', () => {
    expect(coverArt('/covers/minecraft.svg')).toBe('/covers/art/minecraft.jpg')
    expect(coverArt('/covers/god-of-war.svg')).toBe('/covers/art/god-of-war.jpg')
    expect(coverArt('/covers/terraria.svg')).toBe('/covers/art/terraria.jpg')
    expect(coverArt('https://elsewhere.example/minecraft.svg')).toBe('https://elsewhere.example/minecraft.svg')
    expect(coverArt(null)).toBeNull()
  })

  it('Buy Now puts the best offer that can be bought in the cart and opens the cart', async () => {
    const requested = api({
      body: detail([
        { id: 201, in_stock: true, cents: 1729, seller: 'Arcade Harbor' },
        { id: 202, in_stock: true, cents: 1899, seller: 'Northwind Keys' },
        { id: 203, in_stock: false, cents: 1500, seller: 'Sold Out Keys' },
      ]),
    })
    const router = renderAt('/')

    fireEvent.click((await firstCard()).getByRole('button', { name: `Buy ${product.name} now` }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/cart'))
    expect(cart.items()).toEqual([{ offerId: 201, quantity: 1, unitPriceCents: 1729, productName: product.name, sellerName: 'Arcade Harbor' }])
    // The cart page then asks the server what the cart is worth, as for anything added from a product page.
    await waitFor(() => expect(requested).toContain('/api/cart/quote'))
  })

  it('Buy Now pressed twice at once adds one, not two', async () => {
    api({ body: detail([{ id: 201, in_stock: true, cents: 1729, seller: 'Arcade Harbor' }]) })
    const router = renderAt('/')
    const button = (await firstCard()).getByRole('button', { name: `Buy ${product.name} now` })

    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(router.state.location.pathname).toBe('/cart'))
    expect(cart.items().map((item) => item.quantity)).toEqual([1])
  })

  it('Buy Now opens the product page instead when nothing can be bought or the product cannot be fetched', async () => {
    for (const reply of [{ body: detail([{ id: 203, in_stock: false, cents: 1500, seller: 'Sold Out Keys' }]) }, { status: 500, body: { message: 'Server error.' } }]) {
      api(reply)
      const router = renderAt('/')

      fireEvent.click((await firstCard()).getByRole('button', { name: `Buy ${product.name} now` }))

      await waitFor(() => expect(router.state.location.pathname).toBe(`/product/${product.slug}`))
      expect(cart.items()).toEqual([])
      document.body.innerHTML = ''
    }
  })
})
