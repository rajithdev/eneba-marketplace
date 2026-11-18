import type { Ref } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { PriceTag } from '../components/PriceTag'
import { secondaryButton, Spinner } from '../components/States'
import type { Offer, ProductDetail } from '../lib/catalog'
import { formatMoney } from '../lib/money'
import { buyableOffers, lowestCents } from './choices'
import { VersionPicker } from './VersionPicker'

interface Props {
  product: ProductDetail
  /** The offer the buyer chose in the seller list, or the cheapest; null when sold out. */
  offer: Offer | null
  /** How many of each offer (by id) the cart already holds. */
  inCart: Record<number, number>
  onAdd: (offer: Offer) => void
  onChooseCheapest: () => void
  /** While another version loads: what is shown is the previous one, so nothing can be added. */
  busy: boolean
  /** The "Add to cart" button, for the phone's buy bar to know when it has scrolled away. */
  actionRef?: Ref<HTMLButtonElement>
}

/** The yellow "Add to cart": the page's one primary action, here and in the phone's buy bar. */
export const addButton =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-control bg-accent text-base font-black text-black shadow-[0_10px_24px_-12px_rgb(250_211_24/0.7)] hover:bg-accent-strong active:translate-y-px disabled:opacity-60'

/**
 * The buy panel: which version this is, the price of the chosen offer and
 * who sells it, and the button that puts that offer in the cart.
 *
 * Every price is the API's. The cart keeps the offer and the price shown
 * here only to notice a change: the cart page asks the server for the real
 * price and stock again before anything can be paid.
 */
export function PurchasePanel({ product, offer, inCart, onAdd, onChooseCheapest, busy, actionRef }: Props) {
  const buyable = buyableOffers(product.offers)
  const lowest = lowestCents(product.offers)
  const aboveLowest = offer && lowest !== null ? offer.price.amount_cents - lowest : 0
  const highest = buyable.at(-1)

  return (
    <section
      aria-label="Buy"
      aria-busy={busy}
      className="relative rounded-[1.25rem] border border-edge/45 bg-[linear-gradient(165deg,rgb(52_22_120/0.82)_0%,rgb(24_10_58/0.9)_45%,rgb(14_5_38/0.94)_100%)] p-5 shadow-[0_30px_70px_-30px_rgb(4_1_18/1),inset_0_1px_0_rgb(255_255_255/0.08)] backdrop-blur-xl sm:p-6"
    >
      <VersionPicker product={product} />

      <div className="my-5 h-px bg-linear-to-r from-transparent via-edge/40 to-transparent" />

      {offer ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted">{aboveLowest > 0 ? 'Your chosen seller' : 'Lowest price'}</p>
            <p className="inline-flex items-center gap-1 rounded-full bg-region/12 px-2.5 py-1 text-xs font-bold text-region ring-1 ring-region/30">
              <Icon name="check" className="size-3.5" />
              In stock
            </p>
          </div>
          <div className="mt-1">
            <PriceTag price={offer.price} size="large" />
          </div>
          <p className="mt-2 text-sm">
            Sold by <span className="font-bold">{offer.seller.name}</span>
            <span className="text-muted"> · {offer.seller.rating_percent.toFixed(1)}% positive</span>
          </p>
          {aboveLowest > 0 && (
            <p className="mt-1 text-sm text-muted">
              {formatMoney(aboveLowest, offer.price.currency)} more than the lowest price.{' '}
              <button type="button" className="font-bold text-white underline hover:text-accent" onClick={onChooseCheapest}>
                Choose the cheapest
              </button>
            </p>
          )}

          <button ref={actionRef} type="button" className={`${addButton} mt-5`} disabled={busy} onClick={() => onAdd(offer)}>
            {busy ? <Spinner /> : <Icon name="cart" className="size-5" />}
            {busy ? 'Loading this version…' : 'Add to cart'}
          </button>
          <p role="status" className="mt-2 min-h-5 text-center text-sm">
            {inCart[offer.id] > 0 && (
              <>
                {inCart[offer.id]} in your cart ·{' '}
                <Link to="/cart" className="font-bold underline hover:text-accent">
                  View cart
                </Link>
              </>
            )}
          </p>
        </>
      ) : (
        <SoldOut product={product} />
      )}

      <div className="mt-4 rounded-control bg-white/[0.04] px-4 py-3 text-sm ring-1 ring-edge/15">
        <p className="flex items-center gap-2 font-bold">
          <Icon name="sellers" className="size-4 text-muted" />
          {buyable.length} of {product.offers.length} {product.offers.length === 1 ? 'seller' : 'sellers'} in stock
        </p>
        {buyable.length > 1 && lowest !== null && highest && (
          <p className="mt-1 pl-6 text-muted">
            {formatMoney(lowest, highest.price.currency)} to {formatMoney(highest.price.amount_cents, highest.price.currency)}
          </p>
        )}
        {product.offers.length > 0 && (
          <a href="#offers" className="mt-2 inline-flex items-center gap-1 pl-6 font-bold text-white underline-offset-4 hover:text-accent hover:underline">
            Compare sellers
            <Icon name="arrow" className="size-4" />
          </a>
        )}
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs text-muted">
        <Icon name="shield" className="mt-px size-4 shrink-0" />
        Price and stock are checked again in your cart, before you pay.
      </p>
    </section>
  )
}

/** Nothing to buy for this version: says so, and points to the versions that can be bought, if any. */
function SoldOut({ product }: { product: ProductDetail }) {
  const elsewhere = product.variants.filter((variant) => variant.price !== null).slice(0, 3)

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">Availability</p>
      <p className="mt-1 text-3xl font-black text-muted">Sold out</p>
      <p className="mt-2 text-sm text-muted">Every seller is out of keys for this version right now.</p>
      {elsewhere.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-bold">Available in another version</p>
          <ul className="mt-2 grid gap-2">
            {elsewhere.map((variant) => (
              <li key={variant.slug}>
                <Link to={`/product/${variant.slug}`} className={`${secondaryButton} w-full !justify-between gap-3 px-4 text-sm`}>
                  <span>
                    {variant.platform.name} · {variant.region.name}
                  </span>
                  <span className="shrink-0">from {formatMoney(variant.price!.amount_cents, variant.price!.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
