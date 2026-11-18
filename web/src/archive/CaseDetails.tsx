import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { PriceTag } from '../components/PriceTag'
import { primaryButton } from '../components/States'
import type { ProductSummary } from '../lib/catalog'
import { shelfMark } from './shelf'

/**
 * What is written under the shelf about the chosen case: where it stands in
 * the collection, the product's name, the platform it is redeemed on, its
 * region, the lowest price it can be bought for, and the way to its offers.
 *
 * Every value is the API's, shown as the store's own cards show it (the
 * same <PriceTag>, so a discount or "Sold out" reads the same here).
 *
 * The block is the same height whatever it says: room is kept for the
 * longest name and for a price even where there is none. Otherwise a long
 * name would push the button down, and on the stage squeeze the shelf
 * above it, each time another case was chosen.
 */
export function CaseDetails({ product, position, total }: { product: ProductSummary; position: number; total: number }) {
  return (
    <section aria-label="Chosen game" className="flex flex-col items-center px-1 pb-5 text-center sm:px-16 sm:pb-4">
      {/* The row the shelf's two arrows sit at the ends of. */}
      <p className="flex h-11 items-center text-xs sm:h-8 font-extrabold tracking-[0.28em] text-muted tabular-nums">
        <span className="sr-only">Game </span>
        <span className="text-white">{shelfMark(position, total)}</span>
        <span aria-hidden="true" className="px-2 text-edge/70">
          /
        </span>
        <span className="sr-only"> of </span>
        {shelfMark(total, total)}
      </p>

      <div className="flex min-h-[3.75em] max-w-4xl items-center text-xl leading-tight sm:min-h-[2.5em] sm:text-2xl">
        <h2 className="line-clamp-3 font-bold sm:line-clamp-2">{product.name}</h2>
      </div>

      <dl className="mt-1.5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs font-extrabold uppercase tracking-wide">
        {/* On a phone the platform has a line to itself, so the lines are two whatever its length. */}
        <div className="flex w-full justify-center gap-2 sm:w-auto">
          <dt className="text-muted">Platform</dt>
          <dd>{product.platform.name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Region</dt>
          <dd className="text-region">{product.region.name}</dd>
        </div>
        {product.in_stock && (
          <div className="flex gap-2">
            <dt className="text-muted">Sellers</dt>
            <dd>{product.offers_count}</dd>
          </div>
        )}
      </dl>

      <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-left">
        <div className="flex min-h-[46px] items-center">
          <PriceTag price={product.price} label="From" />
        </div>
        <Link to={`/product/${product.slug}`} className={`${primaryButton} gap-2`}>
          View offers
          <Icon name="arrow" className="size-4" />
        </Link>
      </div>
    </section>
  )
}
