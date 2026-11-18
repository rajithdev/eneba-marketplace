/*
 * Painted covers. The backend names each game's cover picture
 * (/covers/<game>.svg, a drawn placeholder). For the games listed here a
 * painted cover exists as well, at /covers/art/<game>.jpg, and every place
 * that shows a cover (store and deals cards, the product page, search
 * suggestions, cart and order lines) shows that one instead. It is also the
 * picture the scroll section's cases carry (cinematic/build.mjs reads the
 * same folder), which is what lets a case become its card without the
 * picture changing.
 *
 * The homepage has three more kinds of picture, chosen the same way: the
 * wide artwork behind the featured banner, the illustration in a
 * promotional tile, and the scene at the top of a best-seller card.
 *
 * Only the picture is chosen here. Which products appear, their names,
 * prices and stock are the backend's.
 */
const PAINTED = new Set(['minecraft', 'hogwarts-legacy', 'ea-sports-fc-25', 'god-of-war', 'doom-eternal', 'forza-horizon-5'])

/** Which game a cover address belongs to ("/covers/minecraft.svg" is "minecraft"), or null when it is not one of ours. */
export const coverGame = (coverUrl: string | null): string | null => coverUrl?.match(/^\/covers\/([a-z0-9-]+)\.svg$/)?.[1] ?? null

/** The painted cover for the game a cover address belongs to, or the address unchanged when there is none. */
export function coverArt(coverUrl: string | null): string | null {
  const game = coverGame(coverUrl)

  return game && PAINTED.has(game) ? `/covers/art/${game}.jpg` : coverUrl
}

const SCENES = new Set(['grand-theft-auto-v', 'minecraft', 'ea-sports-fc-25', 'elden-ring', 'baldurs-gate-3', 'cyberpunk-2077'])
const HEROES = new Set(['elden-ring-shadow-of-the-erdtree'])
const PROMOS: Record<string, string> = { 'steam-wallet-gift-card-20-eur': 'gift-cards', 'xbox-game-pass-ultimate-1-month': 'subscriptions' }

/** A scene of the game, without its title, for the top of a card; null when there is none. */
export function sceneArt(coverUrl: string | null): string | null {
  const game = coverGame(coverUrl)

  return game && SCENES.has(game) ? `/covers/art/scene/${game}.jpg` : null
}

/** Wide artwork for a banner whose picture is this cover; null when there is none. */
export function heroArt(coverUrl: string | null): string | null {
  const game = coverGame(coverUrl)

  return game && HEROES.has(game) ? `/covers/art/hero/${game}.jpg` : null
}

/** The illustration for a promotional tile whose picture is this cover; null when there is none. */
export function promoArt(coverUrl: string | null): string | null {
  const promo = PROMOS[coverGame(coverUrl) ?? '']

  return promo ? `/covers/art/promo/${promo}.png` : null
}
