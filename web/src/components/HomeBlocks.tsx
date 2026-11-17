import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { Banner, HomepageBlock } from '../lib/homepage'
import { DealCard } from './DealCard'
import { PriceTag } from './PriceTag'
import { ProductCard } from './ProductCard'
import { pageTitle, primaryButton, raised, smallSecondaryButton, surface } from './States'

/*
 * One component per type of homepage block. Each draws whatever the API
 * put in the block: which blocks appear, in what order, under what title
 * and with which products or banners is the backend's decision. Nothing
 * here names a product, a banner text or a section title.
 */

/** A block's frame: its title, its optional "see more" link, its content. */
function Block({ block, label, className = '', children }: { block: HomepageBlock; label: string; className?: string; children: ReactNode }) {
  const headingId = useId()

  return (
    <section
      aria-labelledby={block.title ? headingId : undefined}
      aria-label={block.title ? undefined : label}
      className={`mt-12 first:mt-6 ${className}`}
    >
      {(block.title || block.link) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {block.title && (
            <h2 id={headingId} className={pageTitle}>
              {block.title}
            </h2>
          )}
          {block.link && (
            <Link to={block.link.url} className={smallSecondaryButton}>
              {block.link.label}
            </Link>
          )}
        </div>
      )}
      {children}
    </section>
  )
}

/** The top of the page: the first banner large, the others as tiles beside it. */
export function HeroBlock({ block }: { block: HomepageBlock }) {
  const [main, ...others] = block.data.banners ?? []

  if (!main) return null

  return (
    <Block block={block} label="Highlights">
      <div className={`grid gap-3 sm:gap-4 ${others.length > 0 ? 'lg:grid-cols-[2fr_1fr]' : ''}`}>
        <div className="relative flex min-h-[300px] items-center overflow-hidden border border-line bg-panel sm:min-h-[400px]">
          {main.image_url && (
            <img
              src={main.image_url}
              alt=""
              width={600}
              height={800}
              className="absolute -right-6 top-1/2 hidden h-[125%] w-auto -translate-y-1/2 rotate-6 shadow-2xl min-[480px]:block sm:right-6"
            />
          )}
          {/* Keeps the text readable where it overlaps the artwork. */}
          <div className="absolute inset-0 bg-gradient-to-r from-panel via-panel/90 to-transparent" />
          <div className="relative max-w-xl p-6 sm:p-10">
            <h2 className="text-4xl font-black leading-[1.05] sm:text-6xl">{main.title}</h2>
            {main.subtitle && <p className="mt-4 max-w-md text-lg text-muted">{main.subtitle}</p>}
            <Link to={main.link_url} className={`${primaryButton} mt-7`}>
              {main.cta_label ?? main.title}
            </Link>
          </div>
        </div>

        {others.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-1">
            {others.map((banner) => (
              <li key={banner.link_url + banner.title}>
                <BannerTile banner={banner} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Block>
  )
}

/** A smaller banner: the whole tile is one link. */
function BannerTile({ banner }: { banner: Banner }) {
  return (
    <Link to={banner.link_url} className={`group flex h-full min-h-[150px] items-center gap-4 overflow-hidden p-5 ${surface} hover:border-region`}>
      {banner.image_url && <img src={banner.image_url} alt="" width={600} height={800} className="h-28 w-[84px] shrink-0 -rotate-3 object-cover shadow-xl" />}
      <span className="min-w-0">
        <span className="block text-xl font-black leading-tight group-hover:text-accent">{banner.title}</span>
        {banner.subtitle && <span className="mt-1 block text-sm text-muted">{banner.subtitle}</span>}
        {banner.cta_label && <span className="mt-3 block text-sm font-extrabold text-accent underline">{banner.cta_label}</span>}
      </span>
    </Link>
  )
}

/** A chart: products in the order given, each with its rank. */
export function BestSellersBlock({ block }: { block: HomepageBlock }) {
  const products = block.data.products ?? []

  return (
    <Block block={block} label="Best sellers">
      <ol className="grid gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
        {products.map((product, index) => (
          <li key={product.slug}>
            <Link to={`/product/${product.slug}`} className={`group flex h-full items-center gap-3 p-3 sm:gap-4 ${surface} hover:border-region`}>
              <span aria-hidden="true" className="w-9 shrink-0 text-center text-4xl font-black text-accent sm:w-11 sm:text-5xl">
                {index + 1}
              </span>
              {product.cover_image_url && <img src={product.cover_image_url} alt="" width={600} height={800} className="h-24 w-[72px] shrink-0 object-cover" />}
              <span className="min-w-0 flex-1">
                <span className="sr-only">Number {index + 1}: </span>
                <h3 className="line-clamp-2 text-sm font-extrabold leading-snug group-hover:underline">{product.name}</h3>
                <span className="mt-1 block text-xs text-muted">
                  {product.platform.name} · <span className="font-extrabold uppercase text-region">{product.region.name}</span>
                </span>
                <span className="mt-2 block">
                  <PriceTag price={product.price} label="From" />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Block>
  )
}

// A darker band behind a block, from one edge of the window to the other
// (the page's content is narrower; the band is drawn by a pseudo-element
// as wide as the screen, and the shell clips what would stick out).
const band = 'relative isolate py-10 before:absolute before:inset-y-0 before:left-1/2 before:-z-10 before:w-screen before:-translate-x-1/2 before:bg-band'

/** Discounted products on a band of their own, each on a card that shows its discount and buys it. */
export function DealsBlock({ block }: { block: HomepageBlock }) {
  const products = block.data.products ?? []

  return (
    <Block block={block} label="Deals" className={band}>
      <ul className={dealRow}>
        {products.map((product) => (
          <li key={product.slug}>
            <DealCard product={product} headingLevel="h3" />
          </li>
        ))}
      </ul>
    </Block>
  )
}

/** Hand-picked products: the first one large, the rest as a row of cards under it. */
export function FeaturedBlock({ block }: { block: HomepageBlock }) {
  const [spotlight, ...rest] = block.data.products ?? []

  if (!spotlight) return null

  return (
    <Block block={block} label="Featured">
      {/*
        On a desktop the same six columns as the deals above, the first
        product taking two of them. The list of the rest is laid out by
        this grid too ("contents"); its role is stated because some
        browsers forget a list is a list once it has no box of its own.
      */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 lg:grid-cols-6">
        <div className="col-span-2 sm:col-span-4 lg:col-span-2">
          <Link to={`/product/${spotlight.slug}`} className={`group flex h-full items-center gap-4 p-4 sm:gap-6 sm:p-6 ${raised} hover:border-region`}>
            {spotlight.cover_image_url && (
              <img src={spotlight.cover_image_url} alt="" width={600} height={800} className="h-auto w-28 shrink-0 object-cover shadow-2xl sm:w-40" />
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <h3 className="text-xl font-black leading-tight group-hover:underline sm:text-2xl">{spotlight.name}</h3>
              <span className="block text-sm">
                {spotlight.platform.name} · <span className="font-extrabold uppercase text-region">{spotlight.region.name}</span>
              </span>
              <span className="mt-1 block sm:mt-3">
                <PriceTag price={spotlight.price} size="large" label="From" />
                <span className="mt-1 block text-sm text-muted">
                  {spotlight.offers_count} {spotlight.offers_count === 1 ? 'offer' : 'offers'} to compare
                </span>
              </span>
            </span>
          </Link>
        </div>
        {rest.length > 0 && (
          <ul role="list" className="contents">
            {rest.map((product) => (
              <li key={product.slug}>
                <ProductCard product={product} headingLevel="h3" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Block>
  )
}

/**
 * The deals row: two cards to a row on a phone, three on a tablet, six on
 * a desktop. On a desktop the space between cards is a share of the row's
 * width (16px of 1248px) instead of a fixed 16px. The row then keeps its proportions at every desktop width, which is
 * what lets the scroll section's cases land exactly on the covers whether
 * the window is 1024px wide or 1440px.
 */
const dealRow = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6 lg:gap-x-[1.2821%]'
