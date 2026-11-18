import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from '../components/Icon'
import { PriceTag } from '../components/PriceTag'
import type { ProductSummary } from '../lib/catalog'
import { shelfMark } from './shelf'

/**
 * What is written under the shelf about the chosen case, most important
 * first to the eye: the product's name; its lowest price and the way to
 * its offers; the platform it is redeemed on, its region and how many
 * sellers have it; and, smallest, where it stands in the collection.
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
    <section aria-label="Chosen game" className="flex flex-col items-center px-1 pb-[max(1rem,env(safe-area-inset-bottom))] text-center sm:px-16 lg:px-[14%] lg:pb-5">
      {/* The row the shelf's two arrows sit at the ends of on a phone. */}
      <p className="flex h-11 items-center gap-4 text-xs font-extrabold tracking-[0.3em] text-muted tabular-nums lg:h-8">
        <i aria-hidden="true" className="ga-rule" />
        <span>
          <span className="sr-only">Game </span>
          <span className="text-white">{shelfMark(position, total)}</span>
          <span aria-hidden="true" className="px-2 opacity-60">
            /
          </span>
          <span className="sr-only"> of </span>
          {shelfMark(total, total)}
        </span>
        <i aria-hidden="true" className="ga-rule" />
      </p>

      {/* Two lines are kept for it; in a short window one, and the end of a long name is left off (the region is said below). */}
      <div className={`flex min-h-[2.4em] w-full max-w-3xl items-center justify-center text-[1.4rem] leading-[1.2] tracking-tight sm:text-[1.6rem] lg:text-[2rem] ${short}:lg:min-h-[1.2em] ${short}:lg:max-w-4xl ${short}:lg:text-[1.7rem]`}>
        <h2 title={product.name} className={`line-clamp-2 font-black text-balance ${short}:lg:line-clamp-1`}>
          {product.name}
        </h2>
      </div>

      <dl className="mt-2 flex w-full flex-wrap items-center justify-center gap-y-1.5 text-xs font-extrabold uppercase tracking-[0.08em] sm:divide-x sm:divide-white/15 lg:mt-2.5">
        <Fact icon="platform" name="Platform">
          {product.platform.name}
        </Fact>
        <Fact icon="globe" name="Region">
          <span className="text-(--ga-violet-lit)">{product.region.name}</span>
        </Fact>
        {product.in_stock && (
          <Fact icon="sellers" name="Sellers">
            {product.offers_count}
          </Fact>
        )}
      </dl>

      {/*
        The price and the way to the offers. In a narrow window (the rail) they are a bar that stays at
        the foot of the screen while the page is scrolled over it, so they are in reach on a short screen too.
      */}
      <div className="sticky bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-10 mt-4 flex w-full max-w-md items-center justify-center gap-5 rounded-2xl border border-white/10 bg-dusk/92 py-2 pr-2 pl-4 text-left backdrop-blur-md lg:static lg:max-w-none lg:gap-7 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <div className="flex min-h-[56px] items-center">
          <PriceTag price={product.price} label="From" size="large" />
        </div>
        <i aria-hidden="true" className="hidden h-10 w-px bg-white/15 lg:block" />
        <Link to={`/product/${product.slug}`} className="ga-cta inline-flex h-12 flex-1 items-center justify-center gap-2.5 rounded-full px-4 text-base font-extrabold whitespace-nowrap lg:flex-none lg:px-9">
          View offers
          <Icon name="arrow" className="size-[18px]" />
        </Link>
      </div>
    </section>
  )
}

/** A window with little height: what is under the shelf is set closer, so the shelf keeps its size. */
const short = '[@media(max-height:820px)]'

/** One thing said about the chosen game: a small picture, what it is, and its value. */
function Fact({ icon, name, children }: { icon: IconName; name: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 px-3 sm:px-5">
      <Icon name={icon} className="size-4 text-muted" />
      {/* On a phone the picture stands for the word, which is still read out. */}
      <dt className="sr-only text-muted sm:not-sr-only">{name}</dt>
      <dd>{children}</dd>
    </div>
  )
}
