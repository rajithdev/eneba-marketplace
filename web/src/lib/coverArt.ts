/*
 * Painted covers. The backend names each game's cover picture
 * (/covers/<game>.svg, a drawn placeholder). For the games listed here a
 * painted cover exists as well, at /covers/art/<game>.jpg, and the deals
 * cards show that one instead. It is also the picture the scroll section's
 * cases carry (cinematic/build.mjs reads the same folder), which is what
 * lets a case become its card without the picture changing.
 *
 * Only the picture is chosen here. Which products appear, their names,
 * prices and stock are the backend's.
 */
const PAINTED = new Set(['minecraft', 'hogwarts-legacy', 'ea-sports-fc-25', 'doom-eternal', 'forza-horizon-5'])

/** The painted cover for the game a cover address belongs to, or the address unchanged when there is none. */
export function coverArt(coverUrl: string | null): string | null {
  const game = coverUrl?.match(/^\/covers\/([a-z0-9-]+)\.svg$/)?.[1]

  return game && PAINTED.has(game) ? `/covers/art/${game}.jpg` : coverUrl
}
