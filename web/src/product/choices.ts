/*
 * The choices the product page offers, worked out from the API's answer
 * alone: which seller to buy from, and which other version (platform and
 * region) of the game to look at. Kept free of React so it can be tested on
 * its own. Nothing here makes up a price or a version; every answer is a
 * selection from what the API returned.
 */
import type { Money, NamedOption, Offer, ProductDetail, ProductSummary } from '../lib/catalog'

/** The offers that can be bought now. The API lists them first, cheapest first. */
export const buyableOffers = (offers: Offer[]) => offers.filter((offer) => offer.in_stock)

/**
 * The lowest price that can be paid now, or null when every seller is sold
 * out. Several sellers may share it; each of them is marked "Lowest price".
 */
export const lowestCents = (offers: Offer[]): number | null => buyableOffers(offers)[0]?.price.amount_cents ?? null

/**
 * The offer the buy panel shows: the one the buyer chose if it can still be
 * bought, otherwise the cheapest. Null when nothing can be bought.
 */
export function chosenOffer(offers: Offer[], chosenId: number | null): Offer | null {
  const buyable = buyableOffers(offers)

  return buyable.find((offer) => offer.id === chosenId) ?? buyable[0] ?? null
}

/** Every version of the game, this one included. */
export const allVersions = (product: ProductDetail): ProductSummary[] => [product, ...product.variants]

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

export interface PlatformChoice {
  platform: NamedOption
  /** The version opened when this platform is picked. */
  target: ProductSummary
  current: boolean
  /** The cheapest price on this platform in any region, or null when all of them are sold out. */
  from: Money | null
}

/**
 * One choice per platform the game is sold on, in alphabetical order so the
 * list does not reshuffle when the buyer switches. Picking a platform opens
 * the version in the same region when there is one, otherwise its cheapest
 * version that can be bought, otherwise its first.
 */
export function platformChoices(product: ProductDetail): PlatformChoice[] {
  const groups = new Map<string, ProductSummary[]>()
  for (const version of allVersions(product)) {
    groups.set(version.platform.slug, [...(groups.get(version.platform.slug) ?? []), version])
  }

  return [...groups.values()]
    .map((versions) => {
      const buyable = versions.filter((version) => version.price !== null).sort((a, b) => a.price!.amount_cents - b.price!.amount_cents)
      const sameRegion = versions.find((version) => version.region.slug === product.region.slug)

      return {
        platform: versions[0].platform,
        target: sameRegion ?? buyable[0] ?? versions[0],
        current: versions[0].platform.slug === product.platform.slug,
        from: buyable[0]?.price ?? null,
      }
    })
    .sort((a, b) => byName(a.platform, b.platform))
}

/** The regions this version's platform is sold for, this one included, alphabetically. */
export function regionChoices(product: ProductDetail): ProductSummary[] {
  return allVersions(product)
    .filter((version) => version.platform.slug === product.platform.slug)
    .sort((a, b) => byName(a.region, b.region))
}

/** Whether the previous answer may stand in while the next one loads: only when the next is a version of the same game. */
export const isVersionOf = (previous: ProductDetail | undefined, slug: string) =>
  previous !== undefined && previous.variants.some((variant) => variant.slug === slug)

/**
 * The product's name in two parts for the title: the game ("Elden Ring")
 * and what this version is ("Steam Key GLOBAL"). The two together are the
 * product's name exactly, which is what the page's heading must say.
 */
export function splitName(product: Pick<ProductDetail, 'name' | 'game'>): { title: string; rest: string } {
  const { name } = product
  const title = product.game.title

  return name.startsWith(`${title} `) ? { title, rest: name.slice(title.length + 1) } : { title: name, rest: '' }
}
