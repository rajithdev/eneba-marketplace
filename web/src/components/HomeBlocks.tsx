import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { Banner, HomepageBlock } from '../lib/homepage'
import { PriceTag } from './PriceTag'
import { ProductCard } from './ProductCard'
import { primaryButton } from './States'

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
      className={`mt-10 first:mt-6 ${className}`}
    >
      {(block.title || block.link) && (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          {block.title && (
            <h2 id={headingId} className="text-2xl font-black sm:text-3xl">
              {block.title}
            </h2>
          )}
          {block.link && (
            <Link to={block.link.url} className="py-2 text-sm font-extrabold underline hover:text-accent">
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
        <div className="relative flex min-h-[300px] items-center overflow-hidden bg-panel sm:min-h-[380px]">
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
            <Link to={main.link_url} className={`${primaryButton} mt-7 h-12 px-7 text-base`}>
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
    <Link to={banner.link_url} className="group flex h-full min-h-[150px] items-center gap-4 overflow-hidden bg-card p-5 hover:bg-panel">
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
            <Link to={`/product/${product.slug}`} className="group flex h-full items-center gap-3 bg-card p-3 hover:bg-panel sm:gap-4">
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

/** Discounted products on a band of their own, each under its discount. */
export function DealsBlock({ block }: { block: HomepageBlock }) {
  const products = block.data.products ?? []

  return (
    <Block block={block} label="Deals" className="-mx-4 bg-card px-4 py-8 sm:mx-0 sm:px-6">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        {products.map((product) => (
          <li key={product.slug} className="flex flex-col">
            {product.price?.discount_percent != null && (
              <p className="bg-deal py-1 text-center text-lg font-black text-black">
                <span className="sr-only">Save </span>−{product.price.discount_percent}%
              </p>
            )}
            <div className="flex-1 ring-1 ring-line">
              <ProductCard product={product} headingLevel="h3" />
            </div>
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
      <Link to={`/product/${spotlight.slug}`} className="group flex items-center gap-4 bg-panel p-4 hover:bg-line sm:gap-8 sm:p-6">
        {spotlight.cover_image_url && (
          <img src={spotlight.cover_image_url} alt="" width={600} height={800} className="h-auto w-28 shrink-0 object-cover shadow-2xl sm:w-48" />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-2 sm:gap-3">
          <h3 className="text-xl font-black leading-tight group-hover:underline sm:text-4xl">{spotlight.name}</h3>
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

      {rest.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:mt-4 sm:grid-cols-4 sm:gap-4">
          {rest.map((product) => (
            <li key={product.slug}>
              <ProductCard product={product} headingLevel="h3" />
            </li>
          ))}
        </ul>
      )}
    </Block>
  )
}
