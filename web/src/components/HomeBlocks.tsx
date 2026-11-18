import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { gameTitle } from '../lib/catalog'
import { coverArt, heroArt, promoArt, sceneArt } from '../lib/coverArt'
import type { Banner, HomepageBlock } from '../lib/homepage'
import { formatMoney } from '../lib/money'
import { heroMotion, shelfMotion } from '../motion/home'
import { DealCard } from './DealCard'
import { Icon } from './Icon'
import { PriceTag } from './PriceTag'
import { ProductCard } from './ProductCard'
import { glowing, lit, pageTitle, primaryButton, raised, smallSecondaryButton } from './States'

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
            <h2 id={headingId} className={`flex items-center gap-3 ${pageTitle}`}>
              <span aria-hidden="true" className="h-7 w-1.5 rounded-full bg-accent" />
              {block.title}
            </h2>
          )}
          {block.link && (
            <Link to={block.link.url} className={`${smallSecondaryButton} gap-2 px-4`}>
              {block.link.label}
              <Icon name="arrow" className="size-4" />
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
  // As the page scrolls, the artwork travels more slowly than the text (see motion/home.ts).
  const banner = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => heroMotion(banner.current), [])

  if (!main) return null

  const art = heroArt(main.image_url)
  // The headline's last word is set in the accent colour (when there is more than one).
  const words = main.title.split(' ')
  const last = words.length > 1 ? words.pop() : null

  return (
    <Block block={block} label="Highlights">
      <div className={`grid gap-3 sm:gap-4 ${others.length > 0 ? 'lg:grid-cols-[2fr_1fr]' : ''}`}>
        <div ref={banner} className="hero-glass relative isolate flex min-h-[320px] items-center overflow-hidden rounded-card border border-edge/50 shadow-glow sm:min-h-[400px]">
          {art ? (
            // Wide artwork on the right, melting into the banner toward the text.
            <img
              data-hero="art"
              src={art}
              alt=""
              width={892}
              height={726}
              className="absolute inset-y-0 right-0 h-full w-full object-cover object-[70%_center] opacity-45 [mask-image:linear-gradient(to_right,transparent_10%,#000_60%)] sm:w-[66%] sm:opacity-100"
            />
          ) : (
            main.image_url && (
              <>
                <img
                  src={main.image_url}
                  alt=""
                  width={600}
                  height={800}
                  className="absolute -right-6 top-1/2 hidden h-[125%] w-auto -translate-y-1/2 rotate-6 shadow-2xl min-[480px]:block sm:right-6"
                />
                {/* Keeps the text readable where it overlaps the cover. */}
                <div className="absolute inset-0 bg-linear-to-r from-card-mid via-card-mid/90 to-transparent" />
              </>
            )
          )}
          <div data-hero="copy" className="relative max-w-xl p-6 sm:p-10">
            <p className="inline-flex items-center gap-2 rounded-full border border-edge/60 bg-white/5 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted">
              <Icon name="star" className="size-3.5 text-accent" />
              Featured
            </p>
            <h2 className="mt-4 text-4xl font-black leading-[1.05] sm:text-6xl">
              {words.join(' ')}
              {last && (
                <>
                  {' '}
                  <span className="text-accent">{last}</span>
                </>
              )}
            </h2>
            {main.subtitle && <p className="mt-4 max-w-sm text-lg text-muted">{main.subtitle}</p>}
            <Link to={main.link_url} className={`${primaryButton} mt-7 h-12 gap-2 px-6 text-base shadow-[0_0_18px_-4px_rgb(250_211_24/0.7)]`}>
              {main.cta_label ?? main.title}
              <Icon name="arrow" className="size-5" />
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
  const art = promoArt(banner.image_url)

  return (
    <Link to={banner.link_url} className={`tile-glow group flex h-full min-h-[150px] items-center gap-4 overflow-hidden rounded-card border border-edge/40 p-5 shadow-card xl:gap-6 xl:p-6 ${lit}`}>
      {art ? (
        <img src={art} alt="" width={324} height={324} className="size-24 shrink-0 xl:size-36" />
      ) : (
        banner.image_url && <img src={banner.image_url} alt="" width={600} height={800} className="h-28 w-[84px] shrink-0 -rotate-3 rounded-md object-cover shadow-xl" />
      )}
      <span className="min-w-0">
        <span className="block text-xl font-black leading-tight group-hover:text-accent xl:text-2xl">{banner.title}</span>
        {banner.subtitle && <span className="mt-1.5 block text-sm text-muted">{banner.subtitle}</span>}
        {banner.cta_label && (
          <span className="mt-3 inline-flex items-center gap-2 text-sm font-extrabold text-accent">
            <span className="underline underline-offset-4">{banner.cta_label}</span>
            <Icon name="arrow" className="size-4" />
          </span>
        )}
      </span>
    </Link>
  )
}

/** A chart: products in the order given, each with its rank, as a row of tall cards. */
export function BestSellersBlock({ block }: { block: HomepageBlock }) {
  const products = block.data.products ?? []
  // The cards rise into their places as the row scrolls in, and recede as it leaves (see motion/home.ts).
  const list = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => shelfMotion(list.current), [])

  return (
    <Block block={block} label="Best sellers">
      <ol ref={list} className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        {products.map((product, index) => {
          const title = gameTitle(product)
          // A scene of the game where there is one; otherwise its cover, from the top.
          const picture = sceneArt(product.cover_image_url) ?? coverArt(product.cover_image_url)

          return (
            <li key={product.slug}>
              <Link to={`/product/${product.slug}`} className={`group relative flex h-full flex-col overflow-hidden ${glowing}`}>
                {/* The picture fades out toward its foot, into the card, and the text begins over the fade. */}
                <span className="relative block aspect-[5/4] shrink-0 bg-card-mid">
                  {picture && (
                    <img
                      src={picture}
                      alt=""
                      width={400}
                      height={326}
                      className="absolute inset-0 h-full w-full object-cover object-top [mask-image:linear-gradient(to_bottom,#000_55%,transparent_100%)] motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.04]"
                    />
                  )}
                </span>
                <span aria-hidden="true" className="absolute left-2.5 top-2.5 -skew-x-12 rounded-md bg-linear-to-b from-accent-strong to-accent px-2.5 py-0.5 text-sm font-black text-black shadow-[0_2px_8px_rgb(0_0_0/0.45)]">
                  <span className="inline-block skew-x-12">{index + 1}</span>
                </span>

                <span data-reveal="info" className="relative -mt-5 flex flex-1 flex-col px-3 pb-3 xl:px-3.5 xl:pb-4">
                  <span className="sr-only">Number {index + 1}: </span>
                  <h3 className="line-clamp-2 text-[15px] font-black leading-snug group-hover:underline sm:text-base">
                    {title === product.name ? (
                      title
                    ) : (
                      <>
                        <span aria-hidden="true">{title}</span>
                        <span className="sr-only">{product.name}</span>
                      </>
                    )}
                  </h3>
                  <span className="mt-1 block text-[11px] text-muted">
                    {product.platform.name} <span aria-hidden="true">•</span> <span className="font-extrabold uppercase text-region">{product.region.name}</span>
                  </span>

                  {/* The price sits at the foot of the card, whatever the title's length. */}
                  <span className="mt-auto block pt-3">
                    {product.price === null ? (
                      <span className="block text-lg font-extrabold text-muted">Sold out</span>
                    ) : (
                      <>
                        {product.price.original_amount_cents !== null ? (
                          <span className="flex flex-wrap items-center gap-x-2 text-xs font-bold text-muted">
                            <s>
                              <span className="sr-only">Was </span>
                              {formatMoney(product.price.original_amount_cents, product.price.currency)}
                            </s>
                            <span className="rounded-md bg-deal px-1.5 py-0.5 font-extrabold text-black">
                              <span className="sr-only">saving </span>-{product.price.discount_percent}%
                            </span>
                          </span>
                        ) : (
                          <span className="block text-xs text-muted">From</span>
                        )}
                        <span className="block text-xl font-black leading-tight sm:text-[22px]">{formatMoney(product.price.amount_cents, product.price.currency)}</span>
                      </>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
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
          <Link to={`/product/${spotlight.slug}`} className={`group flex h-full items-center gap-4 p-4 sm:gap-6 sm:p-6 ${raised} ${lit}`}>
            {spotlight.cover_image_url && (
              <img src={coverArt(spotlight.cover_image_url) ?? undefined} alt="" width={600} height={800} className="h-auto w-28 shrink-0 rounded-lg object-cover shadow-2xl sm:w-40" />
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
