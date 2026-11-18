import { describe, expect, it } from 'vitest'
import showExample from '../contracts/products.show.json'
import type { ProductDetail } from '../lib/catalog'
import { chosenOffer, isVersionOf, lowestCents, platformChoices, regionChoices, splitName } from './choices'

const product = showExample.response.data as ProductDetail

describe('the seller the buy panel shows', () => {
  it('is the cheapest that can be bought until another is chosen', () => {
    expect(chosenOffer(product.offers, null)?.id).toBe(product.offers[0].id)
    expect(chosenOffer(product.offers, product.offers[2].id)?.id).toBe(product.offers[2].id)
  })

  it('goes back to the cheapest when the chosen one is sold out, and is none when all are', () => {
    const offers = product.offers.map((offer, index) => (index === 2 ? { ...offer, in_stock: false } : offer))
    expect(chosenOffer(offers, offers[2].id)?.id).toBe(offers[0].id)

    const soldOut = product.offers.map((offer) => ({ ...offer, in_stock: false }))
    expect(chosenOffer(soldOut, null)).toBeNull()
    expect(lowestCents(soldOut)).toBeNull()
  })

  it('never takes a sold-out offer as the lowest price, even when it is cheaper', () => {
    const offers = [{ ...product.offers[0], in_stock: false, price: { ...product.offers[0].price, amount_cents: 100 } }, ...product.offers.slice(1)]
    expect(lowestCents(offers)).toBe(product.offers[1].price.amount_cents)
  })
})

describe('the versions offered', () => {
  it('lists each platform once, alphabetically, opening the same region when it exists', () => {
    const choices = platformChoices(product)

    expect(choices.map((choice) => choice.platform.name)).toEqual(['PlayStation Network', 'Steam', 'Xbox Live'])
    // Steam is this version's platform: picking it stays here (Global), although Steam Europe is cheaper.
    const steam = choices.find((choice) => choice.platform.slug === 'steam')!
    expect(steam).toMatchObject({ current: true, target: { slug: product.slug } })
    expect(steam.from?.amount_cents).toBe(3129)
    // No Xbox Global exists: Xbox opens its Europe version.
    expect(choices.find((choice) => choice.platform.slug === 'xbox-live')!.target.slug).toBe('elden-ring-xbox-live-key-europe')
  })

  it('prefers a platform version that can be bought, and says when none can', () => {
    const variants = [
      { ...product.variants[0], slug: 'xbox-us', region: { slug: 'united-states', name: 'United States' }, price: null, in_stock: false },
      { ...product.variants[0], slug: 'xbox-eu' },
    ]
    const xbox = platformChoices({ ...product, variants }).find((choice) => choice.platform.slug === 'xbox-live')!
    expect(xbox.target.slug).toBe('xbox-eu')

    const allSoldOut = platformChoices({ ...product, variants: [variants[0]] }).find((choice) => choice.platform.slug === 'xbox-live')!
    expect(allSoldOut).toMatchObject({ target: { slug: 'xbox-us' }, from: null })
  })

  it('offers only the regions this platform is really sold for', () => {
    expect(regionChoices(product).map((version) => version.region.name)).toEqual(['Europe', 'Global'])
  })

  it('keeps the previous page on screen only while switching between versions of one game', () => {
    expect(isVersionOf(product, 'elden-ring-steam-key-europe')).toBe(true)
    expect(isVersionOf(product, 'minecraft-xbox-live-key-global')).toBe(false)
    expect(isVersionOf(undefined, 'elden-ring-steam-key-europe')).toBe(false)
  })
})

describe('the title', () => {
  it('splits the name into the game and the version, which together are the name', () => {
    expect(splitName(product)).toEqual({ title: 'Elden Ring', rest: 'Steam Key GLOBAL' })
    expect(splitName({ name: 'Something else', game: { ...product.game, title: 'Elden Ring' } })).toEqual({ title: 'Something else', rest: '' })
  })
})
