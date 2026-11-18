import { gameTitle, type ProductSummary } from '../lib/catalog'
import { coverArt } from '../lib/coverArt'
import { formatMoney } from '../lib/money'
import { ProductLink } from '../product/ProductLink'
import { BuyNow } from './BuyButtons'
import { glowing } from './States'

/*
 * A product in the deals row: its cover large, then the game's title, the
 * discount, the price and a button that buys it. Everything shown is what
 * the API sent for the product.
 *
 * The cover's box must keep its shape and place in the card: the picture
 * edge to edge inside a one-pixel border, three wide to four high. The
 * scroll section above this row ends on rendered cases that land exactly
 * on these covers (see cinematic/README.md), and it measures them where
 * they are. The rounding of the cover's top corners is read from here too.
 */

const card = `group relative flex h-full flex-col ${glowing}`

export function DealCard({ product, headingLevel: Heading = 'h3' }: { product: ProductSummary; headingLevel?: 'h2' | 'h3' }) {
  const title = gameTitle(product)
  const cover = coverArt(product.cover_image_url)

  return (
    <article className={card}>
      {/* The cover and the text are one link to the product page; the button below is the only other thing to press. */}
      <ProductLink product={product} className="flex flex-1 flex-col rounded-t-[15px]">
        <div data-cover className="relative aspect-[3/4] overflow-hidden rounded-t-[15px] bg-panel">
          {cover && (
            <img
              src={cover}
              // Decorative: the product name is in the text right below.
              alt=""
              width={600}
              height={800}
              className={`h-full w-full rounded-t-[15px] object-cover ${product.in_stock ? '' : 'opacity-40 grayscale'}`}
            />
          )}
          {!product.in_stock && (
            <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-black/75 py-2 text-center text-xs font-extrabold uppercase tracking-wide">Sold out</span>
          )}
        </div>

        <div className="flex flex-1 flex-col items-center px-2 pt-3 text-center">
          {/* Two lines are always reserved, so badges and prices line up across a row. */}
          <Heading className="line-clamp-2 flex min-h-[2.5em] items-center text-[13px] font-black uppercase leading-tight tracking-wide group-hover:underline sm:text-sm">
            {title === product.name ? (
              title
            ) : (
              <>
                <span aria-hidden="true">{title}</span>
                <span className="sr-only">{product.name}</span>
              </>
            )}
          </Heading>
          {/* Where it is redeemed. Read out as part of the name above. */}
          <p aria-hidden={title === product.name ? undefined : 'true'} className="mt-1 text-[11px] font-bold text-muted">
            {product.platform.name} · {product.region.name}
          </p>

          {product.price === null ? (
            <p className="mt-3 text-lg font-extrabold text-muted">Sold out</p>
          ) : (
            <>
              {product.price.discount_percent !== null && (
                <p className="mt-2.5 rounded-md border border-[#c4a2ff]/40 bg-[linear-gradient(180deg,#8b4dff_0%,#5b21c9_100%)] px-2.5 py-0.5 text-sm font-black leading-tight">
                  <span className="sr-only">Save </span>−{product.price.discount_percent}%
                </p>
              )}
              <p className="mt-1.5 text-[22px] font-black leading-tight sm:text-2xl">{formatMoney(product.price.amount_cents, product.price.currency)}</p>
              <p className="text-xs font-bold text-muted">
                {product.price.original_amount_cents !== null && (
                  <>
                    <s>
                      <span className="sr-only">Was </span>
                      {formatMoney(product.price.original_amount_cents, product.price.currency)}
                    </s>
                    {' · '}
                  </>
                )}
                {product.offers_count} {product.offers_count === 1 ? 'offer' : 'offers'}
              </p>
            </>
          )}
        </div>
      </ProductLink>

      <div className="p-2.5 pt-3">
        <BuyNow product={product} />
      </div>
    </article>
  )
}
