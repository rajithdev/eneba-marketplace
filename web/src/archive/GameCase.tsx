import { memo } from 'react'
import { gameTitle, type ProductSummary } from '../lib/catalog'
import { coverArt } from '../lib/coverArt'

/**
 * One boxed game, as a real box: the cover on its front under a glossy
 * sleeve, a printed spine on its left, the opening edge on its right, the
 * lit rim it has while it is the chosen one, the shadow it stands in and,
 * where asked for, its reflection in the floor (see archive.css).
 *
 * All of it is decoration. The product's name and price are said by the
 * list item the case sits in, so the box itself is hidden from screen
 * readers. Every word and picture on it is the backend's: the product's
 * cover, the platform it is redeemed on, its game's title.
 *
 * Remembered between renders: while the shelf is scrolled the cases around
 * it are redrawn many times a second, and a case that is still the same
 * product has nothing new to work out.
 */
export const GameCase = memo(function GameCase({ product, reflect = false }: { product: ProductSummary; reflect?: boolean }) {
  // The painted cover where the game has one; otherwise the drawn one the API names.
  const cover = coverArt(product.cover_image_url)

  return (
    <span className="ga-case" aria-hidden="true">
      {/* data-cover: what glides into the product page's cover when the case is opened. */}
      <span data-cover className={`ga-face ga-front ${product.in_stock ? '' : 'ga-sold'}`}>
        {cover && <img src={cover} alt="" width={600} height={800} draggable={false} decoding="async" />}
        {/* The same cover is sold for several platforms; the label is what tells two such cases apart. */}
        <span className="ga-label">{product.platform.name}</span>
        {!product.in_stock && <span className="ga-soldout">Sold out</span>}
        <span className="ga-sheen" />
      </span>
      <span className="ga-face ga-spine">
        {cover && <span className="ga-spine-art" style={{ backgroundImage: `url("${cover}")` }} />}
        <span className="ga-spine-title">{gameTitle(product)}</span>
        <span className="ga-spine-mark" />
      </span>
      <span className="ga-face ga-edge" />
      <span className="ga-rim" />
      {reflect && cover && (
        <span className="ga-reflection">
          <img src={cover} alt="" draggable={false} decoding="async" />
        </span>
      )}
      <span className="ga-shadow" />
    </span>
  )
})
