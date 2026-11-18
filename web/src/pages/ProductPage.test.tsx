import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import showExample from '../contracts/products.show.json'
import { cart } from '../lib/cart'
import { coverArt } from '../lib/coverArt'
import { mockApi, renderAt } from '../test/render'

const product = showExample.response.data

function productApi(body: unknown = showExample.response, status = 200) {
  return mockApi((path) => (path.startsWith('/api/products/') ? { status, body } : undefined))
}

const sellerOption = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) })
const buyPanel = () => screen.getByRole('region', { name: 'Buy' })

describe('product page', () => {
  it('asks the API for the product in the address and shows what the game is', async () => {
    const requested = productApi()
    renderAt(`/product/${product.slug}`)

    // The heading is the product's whole name: the game's title, then the version.
    expect(await screen.findByRole('heading', { level: 1, name: product.name })).toBeInTheDocument()
    expect(requested.filter((path) => path.startsWith('/api/products'))).toEqual([`/api/products/${product.slug}`])

    expect(screen.getByText(product.game.description)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: `Cover of ${product.game.title}` })).toHaveAttribute('src', coverArt(product.cover_image_url))
    expect(screen.getByText('25 Feb 2022')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Version' })).getByText('Steam')).toBeInTheDocument()

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByRole('link', { name: 'Store' })).toHaveAttribute('href', '/store')
  })

  it('lists every seller offer in the order the API gave, with what the API says about each', async () => {
    productApi()
    renderAt(`/product/${product.slug}`)

    const group = await screen.findByRole('group', { name: 'Choose a seller' })
    const options = within(group).getAllByRole('radio')
    expect(options).toHaveLength(product.offers.length)
    product.offers.forEach((offer, index) => expect(options[index]).toHaveAccessibleName(expect.stringContaining(offer.seller.name)))

    const first = options[0].closest('label')!
    expect(within(first).getByText('€31.49')).toBeInTheDocument()
    expect(within(first).getByText(/97\.9% positive · 12,406 sales/)).toBeInTheDocument()
    expect(within(group).getAllByText('In stock')).toHaveLength(product.offers.length)

    // A discounted offer shows the API's "was" price and percentage.
    const discounted = sellerOption('Northwind Keys').closest('label')!
    expect(within(discounted).getByText('€43.29')).toBeInTheDocument()
    expect(within(discounted).getByText('-25%')).toBeInTheDocument()
  })

  it('marks every seller at the lowest price, and the cheapest is chosen to begin with', async () => {
    productApi()
    renderAt(`/product/${product.slug}`)

    const group = await screen.findByRole('group', { name: 'Choose a seller' })
    // Two sellers share €31.49 in the example.
    expect(within(group).getAllByText('Lowest price')).toHaveLength(2)
    expect(sellerOption(product.offers[0].seller.name)).toBeChecked()

    const panel = buyPanel()
    expect(within(panel).getByText('Lowest price')).toBeInTheDocument()
    expect(within(panel).getByText('€31.49')).toBeInTheDocument()
    expect(within(panel).getByText(product.offers[0].seller.name)).toBeInTheDocument()
    expect(within(panel).getByText(`${product.offers.length} of ${product.offers.length} sellers in stock`)).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Compare sellers' })).toHaveAttribute('href', '#offers')
  })

  it('shows the chosen seller in the buy panel, how much more it costs, and can go back to the cheapest', async () => {
    productApi()
    renderAt(`/product/${product.slug}`)
    const pricier = product.offers[3]

    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(`^${pricier.seller.name}`) }))

    const panel = buyPanel()
    expect(within(panel).getByText('Your chosen seller')).toBeInTheDocument()
    expect(within(panel).getByText('€34.49')).toBeInTheDocument()
    expect(within(panel).getByText(pricier.seller.name)).toBeInTheDocument()
    expect(within(panel).getByText(/€3\.00 more than the lowest price/)).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: 'Choose the cheapest' }))
    expect(sellerOption(product.offers[0].seller.name)).toBeChecked()
    expect(within(panel).getByText('Lowest price')).toBeInTheDocument()
  })

  it('adds the chosen seller offer to the cart, and one more of it when added again', async () => {
    productApi()
    renderAt(`/product/${product.slug}`)
    // The third seller: dearer than the cheapest (the first two share the lowest price).
    const [best, , other] = product.offers

    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(`^${other.seller.name}`) }))
    const add = within(buyPanel()).getByRole('button', { name: 'Add to cart' })
    fireEvent.click(add)
    fireEvent.click(add)
    fireEvent.click(within(buyPanel()).getByRole('button', { name: 'Choose the cheapest' }))
    fireEvent.click(add)

    expect(cart.items()).toEqual([
      { offerId: other.id, quantity: 2, unitPriceCents: other.price.amount_cents, productName: product.name, sellerName: other.seller.name },
      { offerId: best.id, quantity: 1, unitPriceCents: best.price.amount_cents, productName: product.name, sellerName: best.seller.name },
    ])
    expect(within(sellerOption(other.seller.name).closest('label')!).getByText('2 in cart')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cart, 3 items' })).toBeInTheDocument()
    expect(within(buyPanel()).getByRole('link', { name: 'View cart' })).toHaveAttribute('href', '/cart')
  })

  it('lets nobody choose a seller who is sold out', async () => {
    productApi({ data: { ...product, offers: product.offers.map((offer, index) => (index === 0 ? { ...offer, in_stock: false } : offer)) } })
    renderAt(`/product/${product.slug}`)

    const soldOut = await screen.findByRole('radio', { name: new RegExp(`^${product.offers[0].seller.name}`) })
    expect(soldOut).toBeDisabled()
    expect(soldOut).not.toBeChecked()
    // The next seller is the cheapest that can be bought.
    expect(sellerOption(product.offers[1].seller.name)).toBeChecked()
    expect(within(buyPanel()).getByText(`${product.offers.length - 1} of ${product.offers.length} sellers in stock`)).toBeInTheDocument()
  })

  it('offers the platforms and regions that exist, each a link to its own page', async () => {
    productApi()
    renderAt(`/product/${product.slug}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Platform: Steam' }))
    const platforms = within(buyPanel()).getByRole('list')
    expect(within(platforms).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['PlayStation Networkfrom €36.49', '/product/elden-ring-playstation-network-key-europe'],
      ['Steamfrom €31.29', `/product/${product.slug}`],
      ['Xbox Livefrom €30.49', '/product/elden-ring-xbox-live-key-europe'],
    ])
    expect(within(platforms).getByRole('link', { current: 'page' })).toHaveTextContent('Steam')

    // Escape closes the list and gives the focus back to its button.
    fireEvent.keyDown(platforms, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Platform: Steam' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Platform: Steam' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Region: Global' }))
    const regions = within(buyPanel()).getByRole('list')
    expect(within(regions).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/product/elden-ring-steam-key-europe', `/product/${product.slug}`])
  })

  it('opens another version with its own offers, buying nothing from the old one while it loads', async () => {
    const { offers, variants, game, ...steamGlobal } = product
    const xbox = {
      ...product,
      slug: 'elden-ring-xbox-live-key-europe',
      name: 'Elden Ring Xbox Live Key EUROPE',
      platform: { slug: 'xbox-live', name: 'Xbox Live' },
      region: { slug: 'europe', name: 'Europe' },
      game,
      offers: [{ ...offers[1], id: 99, price: { ...offers[1].price, amount_cents: 3049 } }],
      variants: [steamGlobal, ...variants.slice(1)],
    }
    // The Xbox answer is held back until the test lets it through.
    let release = () => {}
    const xboxReady = new Promise<void>((resolve) => (release = resolve))
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input), 'http://localhost').pathname
      if (path === `/api/products/${product.slug}`) return reply(showExample.response)
      if (path === `/api/products/${xbox.slug}`) {
        await xboxReady
        return reply({ data: xbox })
      }
      return reply({ message: 'Not found.' }, 404)
    })
    const router = renderAt(`/product/${product.slug}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Platform: Steam' }))
    fireEvent.click(within(buyPanel()).getByRole('link', { name: /^Xbox Live/ }))

    // The Steam page stays on screen, but nothing on it can be bought.
    await waitFor(() => expect(router.state.location.pathname).toBe(`/product/${xbox.slug}`))
    expect(within(buyPanel()).getByRole('button', { name: /Loading this version/ })).toBeDisabled()
    expect(screen.getByRole('group', { name: 'Choose a seller' })).toBeDisabled()

    release()
    expect(await screen.findByRole('heading', { level: 1, name: xbox.name })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(within(buyPanel()).getByText('€30.49')).toBeInTheDocument()
    fireEvent.click(within(buyPanel()).getByRole('button', { name: 'Add to cart' }))
    expect(cart.items()).toEqual([expect.objectContaining({ offerId: 99, productName: xbox.name, unitPriceCents: 3049 })])
  })

  it('links to every version of the game with its price, marking this one', async () => {
    productApi()
    renderAt(`/product/${product.slug}`)

    const section = (await screen.findByRole('heading', { name: 'Other platforms and regions' })).closest('section')!
    const links = within(section).getAllByRole('link')

    expect(links.map((link) => link.getAttribute('href'))).toEqual(product.variants.map((variant) => `/product/${variant.slug}`))
    expect(links[0]).toHaveTextContent('Xbox Live')
    expect(links[0]).toHaveTextContent('Europe')
    expect(links[0]).toHaveTextContent('From €30.49')
    expect(within(section).getByText('Viewing').closest('[aria-current="page"]')).toHaveTextContent('Steam')
  })

  it('shows a sold-out product as sold out, pointing to a version that can be bought', async () => {
    productApi({
      data: {
        ...product,
        in_stock: false,
        price: null,
        offers_count: 0,
        offers: product.offers.map((offer) => ({ ...offer, in_stock: false })),
        variants: [{ ...product.variants[0], in_stock: false, price: null, offers_count: 0 }, product.variants[1]],
      },
    })
    renderAt(`/product/${product.slug}`)

    await screen.findByRole('heading', { level: 1, name: product.name })
    const panel = buyPanel()
    expect(within(panel).getByText('Sold out')).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument()
    expect(within(panel).getByText(`0 of ${product.offers.length} sellers in stock`)).toBeInTheDocument()
    // Only the version that can be bought is suggested.
    const suggestion = within(panel).getByRole('link', { name: /Steam · Europe/ })
    expect(suggestion).toHaveAttribute('href', `/product/${product.variants[1].slug}`)
    expect(within(panel).queryByRole('link', { name: /Xbox Live · Europe/ })).not.toBeInTheDocument()

    const group = screen.getByRole('group', { name: 'Choose a seller' })
    expect(within(group).queryByText('Lowest price')).not.toBeInTheDocument()
    expect(within(group).getAllByText('Sold out')).toHaveLength(product.offers.length)
    within(group).getAllByRole('radio').forEach((radio) => expect(radio).toBeDisabled())
    // Offers still show their price: the buyer can see what it costs when back.
    expect(within(group).getAllByText('€31.49').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^Add to cart/ })).not.toBeInTheDocument()
  })

  it('says so when no seller offers this version at all', async () => {
    productApi({ data: { ...product, in_stock: false, price: null, offers_count: 0, offers: [] } })
    renderAt(`/product/${product.slug}`)

    expect(await screen.findByText('No seller is offering this version at the moment.')).toBeInTheDocument()
    expect(within(buyPanel()).getByText('Sold out')).toBeInTheDocument()
  })

  it('says so when the product does not exist, without retrying', async () => {
    const requested = productApi({ message: 'Product not found.' }, 404)
    renderAt('/product/no-such-product')

    expect(await screen.findByRole('heading', { name: 'Product not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Browse the store' })).toHaveAttribute('href', '/store')
    expect(requested.filter((path) => path.startsWith('/api/products'))).toHaveLength(1)
  })

  it('shows a server failure as a failure, not as a missing product', async () => {
    productApi({ message: 'Server Error' }, 500)
    renderAt(`/product/${product.slug}`)

    expect(await screen.findByRole('heading', { name: 'The product could not be loaded' })).toBeInTheDocument()
    expect(screen.queryByText('Product not found')).not.toBeInTheDocument()
  })

  it('shows the cover’s first letter instead of a broken picture', async () => {
    productApi({ data: { ...product, cover_image_url: null } })
    renderAt(`/product/${product.slug}`)

    await screen.findByRole('heading', { level: 1, name: product.name })
    expect(screen.queryByRole('img', { name: /Cover of/ })).not.toBeInTheDocument()
  })
})
